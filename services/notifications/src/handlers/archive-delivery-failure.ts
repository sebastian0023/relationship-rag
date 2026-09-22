import { deliveryEventSchema } from '@relationship-rag/contracts';
import { createJsonLogger, createMetrics } from '@relationship-rag/observability';
import { DynamoDbDeliveryRepository } from '../adapters/dynamodb-delivery-repository.js';

interface SqsEvent {
  readonly Records: readonly { readonly messageId: string; readonly body: string }[];
}
interface BatchResponse {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
}
export const createFailureHandler = (tableName: string) => {
  const repository = new DynamoDbDeliveryRepository(tableName);
  const logger = createJsonLogger();
  const metrics = createMetrics('delivery');
  return async (event: SqsEvent): Promise<BatchResponse> => {
    const failures: { itemIdentifier: string }[] = [];
    for (const record of event.Records) {
      try {
        const request = deliveryEventSchema.parse(JSON.parse(record.body) as unknown);
        await repository.fail(request.coupleId, request.deliveryId, 'DELIVERY_RETRIES_EXHAUSTED');
        logger.log('error', 'delivery.failed', { deliveryId: request.deliveryId });
        metrics.put('TerminalFailure', 1);
      } catch {
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
};
const tableName = process.env['APPLICATION_TABLE_NAME'];
export const handler = async (event: SqsEvent): Promise<BatchResponse> => {
  if (tableName === undefined) throw new Error('APPLICATION_TABLE_NAME is required.');
  return createFailureHandler(tableName)(event);
};
