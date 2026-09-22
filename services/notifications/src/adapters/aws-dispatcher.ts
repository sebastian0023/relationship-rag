import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { deliveryEventSchema } from '@relationship-rag/contracts';
import type { Dispatcher } from '../application/delivery.js';

export class AwsDispatcher implements Dispatcher {
  private readonly sqs: SQSClient;
  private readonly scheduler: SchedulerClient;
  public constructor(
    private readonly queueUrl: string,
    private readonly queueArn: string,
    private readonly roleArn: string,
    private readonly dlqArn: string,
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
    try {
      await this.scheduler.send(
        new CreateScheduleCommand({
          Name: `delivery-${deliveryId}`,
          ScheduleExpression: `at(${new Date(deliveryAt).toISOString().replace(/\.\d{3}Z$/, '')})`,
          FlexibleTimeWindow: { Mode: 'OFF' },
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: this.queueArn,
            RoleArn: this.roleArn,
            Input: body,
            DeadLetterConfig: { Arn: this.dlqArn },
            RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 5 },
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConflictException') throw error;
    }
  }
}
