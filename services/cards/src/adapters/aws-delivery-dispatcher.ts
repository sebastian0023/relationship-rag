import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { deliveryEventSchema } from '@relationship-rag/contracts';
import type { DeliveryDispatcher } from '../application/ports.js';

export class AwsDeliveryDispatcher implements DeliveryDispatcher {
  private readonly sqs: SQSClient;
  private readonly scheduler: SchedulerClient;
  public constructor(
    private readonly queueUrl: string,
    private readonly queueArn: string,
    private readonly schedulerRoleArn: string,
    private readonly schedulerDlqArn: string,
    sqs?: SQSClient,
    scheduler?: SchedulerClient,
  ) {
    this.sqs = sqs ?? new SQSClient({});
    this.scheduler = scheduler ?? new SchedulerClient({});
  }

  public async dispatch(
    deliveryId: string,
    coupleId: string,
    deliveryAt: string,
    now: string,
  ): Promise<void> {
    const body = JSON.stringify(deliveryEventSchema.parse({ deliveryId, coupleId }));
    if (Date.parse(deliveryAt) <= Date.parse(now)) {
      await this.sqs.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: body }));
      return;
    }
    const scheduleAt = new Date(deliveryAt).toISOString().replace(/\.\d{3}Z$/, '');
    try {
      await this.scheduler.send(
        new CreateScheduleCommand({
          Name: `delivery-${deliveryId}`,
          ScheduleExpression: `at(${scheduleAt})`,
          FlexibleTimeWindow: { Mode: 'OFF' },
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: this.queueArn,
            RoleArn: this.schedulerRoleArn,
            Input: body,
            DeadLetterConfig: { Arn: this.schedulerDlqArn },
            RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 },
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConflictException') throw error;
    }
  }
}
