import { DynamoDbDeliveryRepository } from '../adapters/dynamodb-delivery-repository.js';
import { AwsDispatcher } from '../adapters/aws-dispatcher.js';
import { DispatchCoordinator } from '../application/delivery.js';

export const createDispatchHandler = (
  tableName: string,
  coupleId: string,
  queueUrl: string,
  queueArn: string,
  roleArn: string,
  dlqArn: string,
) => {
  const coordinator = new DispatchCoordinator(
    coupleId,
    new DynamoDbDeliveryRepository(tableName),
    new AwsDispatcher(queueUrl, queueArn, roleArn, dlqArn),
  );
  return async (): Promise<void> => coordinator.run();
};
const tableName = process.env['APPLICATION_TABLE_NAME'];
const coupleId = process.env['COUPLE_ID'];
const queueUrl = process.env['DELIVERY_QUEUE_URL'];
const queueArn = process.env['DELIVERY_QUEUE_ARN'];
const roleArn = process.env['SCHEDULER_ROLE_ARN'];
const dlqArn = process.env['SCHEDULER_DLQ_ARN'];
export const handler = async (): Promise<void> => {
  if (
    [tableName, coupleId, queueUrl, queueArn, roleArn, dlqArn].some((value) => value === undefined)
  )
    throw new Error('Dispatch handler configuration is required.');
  return createDispatchHandler(tableName!, coupleId!, queueUrl!, queueArn!, roleArn!, dlqArn!)();
};
