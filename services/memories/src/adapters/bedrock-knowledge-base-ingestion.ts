import {
  BedrockAgentClient,
  GetIngestionJobCommand,
  StartIngestionJobCommand,
  StopIngestionJobCommand,
} from '@aws-sdk/client-bedrock-agent';
import type {
  KnowledgeBaseIngestion,
  RemoteJobStatus,
} from '../application/ingestion-coordinator.js';

export class BedrockKnowledgeBaseIngestion implements KnowledgeBaseIngestion {
  private readonly client: BedrockAgentClient;
  public constructor(
    private readonly knowledgeBaseId: string,
    private readonly dataSourceId: string,
    client?: BedrockAgentClient,
  ) {
    this.client = client ?? new BedrockAgentClient({});
  }
  public async start(idempotencyToken: string): Promise<string> {
    const result = await this.client.send(
      new StartIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        clientToken: idempotencyToken,
      }),
    );
    const id = result.ingestionJob?.ingestionJobId;
    if (id === undefined) throw new Error('Bedrock did not return an ingestion job ID.');
    return id;
  }
  public async status(jobId: string): Promise<RemoteJobStatus> {
    const result = await this.client.send(
      new GetIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        ingestionJobId: jobId,
      }),
    );
    const status = result.ingestionJob?.status;
    if (
      status === 'COMPLETE' ||
      status === 'FAILED' ||
      status === 'STOPPED' ||
      status === 'STARTING' ||
      status === 'IN_PROGRESS'
    )
      return status;
    return 'FAILED';
  }
  public async stop(jobId: string): Promise<void> {
    await this.client.send(
      new StopIngestionJobCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        dataSourceId: this.dataSourceId,
        ingestionJobId: jobId,
      }),
    );
  }
}
