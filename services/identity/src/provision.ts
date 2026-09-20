import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  type AttributeType,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  membershipRecordSchema,
  provisionMemberRequestSchema,
  type ProvisionMemberRequest,
} from '@relationship-rag/contracts';

interface ProvisionEnvironment {
  readonly tableName: string;
  readonly coupleId: string;
  readonly userPoolId: string;
}

const requireEnvironment = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
};

const environment = (): ProvisionEnvironment => ({
  tableName: requireEnvironment('APPLICATION_TABLE_NAME'),
  coupleId: requireEnvironment('COUPLE_ID'),
  userPoolId: requireEnvironment('USER_POOL_ID'),
});

const argument = (name: string): string | undefined => {
  const position = process.argv.indexOf(name);
  return position === -1 ? undefined : process.argv[position + 1];
};

const requestFromArguments = (): ProvisionMemberRequest =>
  provisionMemberRequestSchema.parse({
    email: argument('--email'),
    displayName: argument('--display-name'),
    role: argument('--role'),
  });

const attribute = (attributes: AttributeType[] | undefined, name: string): string | undefined =>
  attributes?.find((item) => item.Name === name)?.Value;

class Provisioner {
  private readonly dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  private readonly cognito = new CognitoIdentityProviderClient({});

  public constructor(private readonly config: ProvisionEnvironment) {}

  public async apply(input: ProvisionMemberRequest, resendInvitation: boolean): Promise<void> {
    const username = input.email.toLowerCase();
    await this.reserveRole(input.role, username);
    const userId = await this.ensureCognitoUser(input, username, resendInvitation);
    await this.cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: this.config.userPoolId,
        Username: username,
        GroupName: input.role,
      }),
    );
    await this.activateMembership(input, userId);
  }

  private async reserveRole(role: ProvisionMemberRequest['role'], username: string): Promise<void> {
    const slot = `${role.toLowerCase()}Username`;
    await this.dynamo.send(
      new UpdateCommand({
        TableName: this.config.tableName,
        Key: { PK: `COUPLE#${this.config.coupleId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET #slot = if_not_exists(#slot, :username)',
        ConditionExpression: 'attribute_not_exists(#slot) OR #slot = :username',
        ExpressionAttributeNames: { '#slot': slot },
        ExpressionAttributeValues: { ':username': username },
      }),
    );
  }

  private async ensureCognitoUser(
    input: ProvisionMemberRequest,
    username: string,
    resendInvitation: boolean,
  ): Promise<string> {
    try {
      const existing = await this.cognito.send(
        new AdminGetUserCommand({ UserPoolId: this.config.userPoolId, Username: username }),
      );
      const userId = attribute(existing.UserAttributes, 'sub');
      if (userId === undefined) throw new Error('Existing Cognito user has no subject.');
      if (resendInvitation) {
        await this.cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: this.config.userPoolId,
            Username: username,
            MessageAction: 'RESEND',
          }),
        );
      }
      return userId;
    } catch (caught: unknown) {
      if (!(caught instanceof Error) || caught.name !== 'UserNotFoundException') throw caught;
    }

    const created = await this.cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: this.config.userPoolId,
        Username: username,
        UserAttributes: [
          { Name: 'email', Value: input.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: input.displayName },
        ],
      }),
    );
    const userId = attribute(created.User?.Attributes, 'sub');
    if (userId === undefined) throw new Error('Created Cognito user has no subject.');
    return userId;
  }

  private async activateMembership(input: ProvisionMemberRequest, userId: string): Promise<void> {
    const record = {
      userId,
      coupleId: this.config.coupleId,
      role: input.role,
      displayName: input.displayName,
      status: 'ACTIVE' as const,
    };
    try {
      await this.dynamo.send(
        new PutCommand({
          TableName: this.config.tableName,
          Item: { PK: `COUPLE#${this.config.coupleId}`, SK: `MEMBER#${userId}`, ...record },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
    } catch (caught: unknown) {
      if (!(caught instanceof Error) || caught.name !== 'ConditionalCheckFailedException')
        throw caught;
      const existing = await this.dynamo.send(
        new GetCommand({
          TableName: this.config.tableName,
          Key: { PK: `COUPLE#${this.config.coupleId}`, SK: `MEMBER#${userId}` },
          ConsistentRead: true,
        }),
      );
      const parsed = membershipRecordSchema.safeParse(existing.Item);
      if (!parsed.success || JSON.stringify(parsed.data) !== JSON.stringify(record)) {
        throw new Error('A different membership already exists for this Cognito subject.', {
          cause: caught,
        });
      }
    }
  }
}

const isApply = process.argv.includes('--apply');
const resendInvitation = process.argv.includes('--resend-invitation');
const request = requestFromArguments();

if (!isApply) {
  process.stdout.write(JSON.stringify({ mode: 'dry-run', role: request.role }) + '\n');
} else {
  await new Provisioner(environment()).apply(request, resendInvitation);
  process.stdout.write(JSON.stringify({ mode: 'applied', role: request.role }) + '\n');
}
