import { createJsonLogger } from '@relationship-rag/observability';
import { DynamoDbMemoryRepository } from '../adapters/dynamodb-memory-repository.js';
import { S3MemoryDocumentStore } from '../adapters/s3-memory-document-store.js';
import { BedrockKnowledgeBaseIngestion } from '../adapters/bedrock-knowledge-base-ingestion.js';
import { IngestionCoordinator } from '../application/ingestion-coordinator.js';

export const handler = async (): Promise<void> => {
  const table = process.env['APPLICATION_TABLE_NAME'];
  const bucket = process.env['RAG_SOURCE_BUCKET_NAME'];
  const coupleId = process.env['COUPLE_ID'];
  const knowledgeBaseId = process.env['KNOWLEDGE_BASE_ID'];
  const dataSourceId = process.env['DATA_SOURCE_ID'];
  if ([table, bucket, coupleId, knowledgeBaseId, dataSourceId].some((value) => value === undefined))
    throw new Error('Ingestion coordinator configuration is required.');
  await new IngestionCoordinator(
    coupleId!,
    new DynamoDbMemoryRepository(table!),
    new S3MemoryDocumentStore(bucket!),
    new BedrockKnowledgeBaseIngestion(knowledgeBaseId!, dataSourceId!),
    createJsonLogger(),
  ).run();
};
