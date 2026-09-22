import { createHash } from 'node:crypto';
import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type RetrievalFilter,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { MemoryRetrievalFilters } from '@relationship-rag/contracts';
import type { MemoryRetriever, RetrievedMemory } from '../application/ports.js';

interface CanonicalMemory {
  readonly memoryId: string;
  readonly coupleId: string;
  readonly title: string;
  readonly body: string;
  readonly fingerprint: string;
}
export interface CanonicalMemoryLookup {
  find(coupleId: string, memoryId: string): Promise<CanonicalMemory | null>;
}
const hash = (value: string) =>
  createHash('sha256')
    .update(value.trim().toLocaleLowerCase('en-US'))
    .digest('base64url')
    .slice(0, 22);
const epoch = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 1000;

export const buildRetrievalFilter = (
  coupleId: string,
  filters?: MemoryRetrievalFilters,
): RetrievalFilter => {
  const all: RetrievalFilter[] = [{ equals: { key: 'coupleId', value: coupleId } }];
  if (filters?.occurredOnFrom !== undefined)
    all.push({ greaterThanOrEquals: { key: 'occurredOn', value: epoch(filters.occurredOnFrom) } });
  if (filters?.occurredOnTo !== undefined)
    all.push({ lessThanOrEquals: { key: 'occurredOn', value: epoch(filters.occurredOnTo) } });
  if (filters?.category !== undefined)
    all.push({ equals: { key: 'category', value: hash(filters.category) } });
  if (filters?.tags !== undefined && filters.tags.length > 0)
    all.push({
      orAll: filters.tags.map((tag) => ({ listContains: { key: 'tags', value: hash(tag) } })),
    });
  return all.length === 1 ? all[0]! : { andAll: all };
};

export class BedrockMemoryRetriever implements MemoryRetriever {
  private readonly client: BedrockAgentRuntimeClient;
  public constructor(
    private readonly knowledgeBaseId: string,
    private readonly memories: CanonicalMemoryLookup,
    client?: BedrockAgentRuntimeClient,
  ) {
    this.client = client ?? new BedrockAgentRuntimeClient({ maxAttempts: 2 });
  }
  public async retrieve(
    coupleId: string,
    query: string,
    filters?: MemoryRetrievalFilters,
    signal?: AbortSignal,
  ): Promise<readonly RetrievedMemory[]> {
    const result = await this.client.send(
      new RetrieveCommand({
        knowledgeBaseId: this.knowledgeBaseId,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: {
            numberOfResults: 5,
            filter: buildRetrievalFilter(coupleId, filters),
          },
        },
      }),
      signal === undefined ? undefined : { abortSignal: signal },
    );
    const unique = new Set<string>();
    const verified: RetrievedMemory[] = [];
    for (const item of result.retrievalResults ?? []) {
      const metadata = item.metadata ?? {};
      const memoryId = typeof metadata['memoryId'] === 'string' ? metadata['memoryId'] : undefined;
      const fingerprint =
        typeof metadata['fingerprint'] === 'string' ? metadata['fingerprint'] : undefined;
      if (memoryId === undefined || fingerprint === undefined || unique.has(memoryId)) continue;
      const memory = await this.memories.find(coupleId, memoryId);
      if (memory === null || memory.coupleId !== coupleId || memory.fingerprint !== fingerprint)
        continue;
      unique.add(memoryId);
      verified.push({
        memoryId,
        title: memory.title,
        content: memory.body,
        relevance: item.score ?? 0,
      });
    }
    return verified;
  }
}
