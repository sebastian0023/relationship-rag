import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';

interface EvaluationCase {
  id: string;
  question: string;
  expectedMemoryIndex?: number;
  requiredFact?: string;
  abstain?: boolean;
}
interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export async function runLiveAiEvaluation(input: {
  tag: string;
  coupleId: string;
  ownerId: string;
  knowledgeBaseId: string;
  memoryIds: string[];
  api: (method: string, path: string, data?: Record<string, unknown>) => Promise<ApiResult>;
  recordConversation: (id: string, createdAt: string) => Promise<void>;
}) {
  const dataset = JSON.parse(
    await readFile(new URL('../rag-evals/live-synthetic.v1.json', import.meta.url), 'utf8'),
  ) as {
    version: number;
    minimumRecallAt5: number;
    minimumAbstentionRate: number;
    cases: EvaluationCase[];
  };
  if (
    dataset.version !== 1 ||
    dataset.cases.length !== 20 ||
    new Set(dataset.cases.map((item) => item.id)).size !== dataset.cases.length
  )
    throw new Error('The live AI dataset must have 20 unique versioned cases.');
  const tagHash = createHash('sha256')
    .update(input.tag.toLowerCase())
    .digest('base64url')
    .slice(0, 22);
  const bedrock = new BedrockAgentRuntimeClient({ region: 'us-east-1', maxAttempts: 2 });
  let retrieved = 0;
  let grounded = 0;
  let abstained = 0;
  let unknown = 0;
  const failures: string[] = [];
  for (const item of dataset.cases) {
    const question = item.question.replaceAll('%TAG%', input.tag);
    if (item.expectedMemoryIndex !== undefined) {
      const result = await bedrock.send(
        new RetrieveCommand({
          knowledgeBaseId: input.knowledgeBaseId,
          retrievalQuery: { text: question },
          retrievalConfiguration: {
            vectorSearchConfiguration: {
              numberOfResults: 5,
              filter: {
                andAll: [
                  { equals: { key: 'coupleId', value: input.coupleId } },
                  { listContains: { key: 'tags', value: tagHash } },
                ],
              },
            },
          },
        }),
      );
      const ids = (result.retrievalResults ?? []).map((row) => row.metadata?.['memoryId']);
      if (ids.includes(input.memoryIds[item.expectedMemoryIndex])) retrieved += 1;
      if (ids.some((id) => typeof id === 'string' && !input.memoryIds.includes(id)))
        failures.push(`${item.id}: cross-fixture retrieval`);
    }
    const conversation = await input.api('POST', '/conversations');
    if (conversation.status !== 201) throw new Error(`${item.id}: conversation creation failed.`);
    const conversationId = String(conversation.body['conversationId']);
    await input.recordConversation(conversationId, String(conversation.body['createdAt']));
    const answer = await input.api('POST', `/conversations/${conversationId}/messages`, {
      requestId: randomUUID(),
      question,
      filters: { tags: [input.tag] },
    });
    if (answer.status !== 201) {
      failures.push(`${item.id}: API status ${answer.status}`);
      continue;
    }
    const citations = (answer.body['citations'] as { memoryId: string }[] | undefined) ?? [];
    if (citations.some((citation) => !input.memoryIds.includes(citation.memoryId)))
      failures.push(`${item.id}: citation outside fixture`);
    if (item.abstain) {
      unknown += 1;
      if (answer.body['abstained'] === true && citations.length === 0) abstained += 1;
      else failures.push(`${item.id}: did not abstain`);
    } else if (item.expectedMemoryIndex !== undefined && item.requiredFact) {
      const expectedMemoryId = input.memoryIds[item.expectedMemoryIndex];
      const factPresent = String(answer.body['answer'] ?? '')
        .toLowerCase()
        .includes(item.requiredFact.toLowerCase());
      if (
        answer.body['abstained'] === false &&
        factPresent &&
        citations.some((citation) => citation.memoryId === expectedMemoryId)
      )
        grounded += 1;
      else failures.push(`${item.id}: missing required fact or citation`);
    }
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
  const known = dataset.cases.length - unknown;
  const recallAt5 = retrieved / known;
  const abstentionRate = abstained / unknown;
  if (
    recallAt5 < dataset.minimumRecallAt5 ||
    abstentionRate < dataset.minimumAbstentionRate ||
    grounded !== known ||
    failures.length > 0
  )
    throw new Error(
      `Live AI evaluation failed: recall@5 ${recallAt5}, abstention ${abstentionRate}, grounded ${grounded}/${known}; cases ${failures.join(', ')}`,
    );
  return { cases: dataset.cases.length, recallAt5, abstentionRate, grounded, failures: 0 };
}
