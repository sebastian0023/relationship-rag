import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { membershipRecordSchema, type MembershipRecord } from '@relationship-rag/contracts';
import type { MembershipRepository } from '../application/ports.js';

export class DynamoDbMembershipRepository implements MembershipRepository {
  public constructor(
    private readonly tableName: string,
    private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ) {}

  public async findByUserId(
    coupleId: string,
    userId: string,
  ): Promise<MembershipRecord | undefined> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `COUPLE#${coupleId}`, SK: `MEMBER#${userId}` },
        ConsistentRead: true,
      }),
    );
    const parsed = membershipRecordSchema.safeParse(result.Item);
    return parsed.success ? parsed.data : undefined;
  }
}
