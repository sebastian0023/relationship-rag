import type {
  ChatTurn,
  Conversation,
  ConversationSummary,
  MemoryRetrievalFilters,
} from '@relationship-rag/contracts';

export interface RetrievedMemory {
  readonly memoryId: string;
  readonly title: string;
  readonly content: string;
  readonly relevance: number;
}

export interface MemoryRetriever {
  retrieve(
    coupleId: string,
    query: string,
    filters?: MemoryRetrievalFilters,
  ): Promise<readonly RetrievedMemory[]>;
}

export interface GroundedGeneration {
  readonly answer: string;
  readonly citedMemoryIds: readonly string[];
  readonly abstained: boolean;
}

export interface GroundedAnswerGenerator {
  generate(question: string, evidence: readonly RetrievedMemory[]): Promise<GroundedGeneration>;
}

export interface ConversationRewriter {
  resolve(question: string, history: readonly ChatTurn[]): Promise<string>;
}

export interface ConversationRepository {
  create(conversation: ConversationSummary, userId: string, coupleId: string): Promise<void>;
  renameIfNew(
    coupleId: string,
    userId: string,
    conversationId: string,
    title: string,
  ): Promise<void>;
  list(
    coupleId: string,
    userId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ readonly items: readonly ConversationSummary[]; readonly nextCursor?: string }>;
  get(
    coupleId: string,
    userId: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
  ): Promise<Conversation | null>;
  findTurnByRequestId(
    coupleId: string,
    userId: string,
    conversationId: string,
    requestId: string,
  ): Promise<ChatTurn | null>;
  reserveTurn(
    coupleId: string,
    userId: string,
    conversationId: string,
    turn: ChatTurn,
  ): Promise<void>;
  completeTurn(
    coupleId: string,
    userId: string,
    conversationId: string,
    turn: ChatTurn,
  ): Promise<void>;
  failTurn(coupleId: string, userId: string, conversationId: string, turn: ChatTurn): Promise<void>;
  completedTurns(
    coupleId: string,
    userId: string,
    conversationId: string,
    limit: number,
  ): Promise<readonly ChatTurn[]>;
}
