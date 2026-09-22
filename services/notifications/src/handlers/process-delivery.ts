import { deliveryEventSchema } from '@relationship-rag/contracts';
import { createJsonLogger, createMetrics } from '@relationship-rag/observability';
import { DynamoDbDeliveryRepository } from '../adapters/dynamodb-delivery-repository.js';
import { DeliveryService } from '../application/delivery.js';

interface SqsEvent {
  readonly Records: readonly { readonly messageId: string; readonly body: string }[];
}
interface BatchResponse {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
}

export const createDeliveryHandler = (tableName: string) => {
  const service = new DeliveryService(new DynamoDbDeliveryRepository(tableName));
  const logger = createJsonLogger();
  const metrics = createMetrics('delivery');
  return async (event: SqsEvent): Promise<BatchResponse> => {
    const failures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        const request = deliveryEventSchema.parse(JSON.parse(record.body) as unknown);
        const result = await service.deliver(request.coupleId, request.deliveryId);
        logger.log('info', 'delivery.completed', {
          deliveryId: request.deliveryId,
          duplicate: result === 'ALREADY_DELIVERED',
        });
      } catch {
        failures.push({ itemIdentifier: record.messageId });
        logger.log('warn', 'delivery.retry', { messageId: record.messageId });
        metrics.put('RecordFailure', 1);
      }
    }
    metrics.put('WorkerHeartbeat', 1);
    return { batchItemFailures: failures };
  };
};
const tableName = process.env['APPLICATION_TABLE_NAME'];
export const handler = async (event: SqsEvent): Promise<BatchResponse> => {
  if (tableName === undefined) throw new Error('APPLICATION_TABLE_NAME is required.');
  return createDeliveryHandler(tableName)(event);
};
