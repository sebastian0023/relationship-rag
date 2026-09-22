import type {
  ChatTurn,
  Conversation,
  ConversationSummary,
  CreateMessageRequest,
} from '@relationship-rag/contracts';
import { ConflictError, ResourceNotFoundError } from '@relationship-rag/domain';
import type {
  ConversationRepository,
  ConversationRewriter,
  GroundedAnswerGenerator,
  MemoryRetriever,
  RetrievedMemory,
} from './ports.js';

export interface IdGenerator {
  next(): string;
}

export interface Clock {
  now(): string;
}

const abstention = (question: string): string =>
  /[¿áéíóúñ]/i.test(question)
    ? 'No tengo suficiente información en los recuerdos compartidos para responder eso.'
    : 'I do not have enough information in the shared memories to answer that.';

export class ConversationService {
  public constructor(
    private readonly conversations: ConversationRepository,
    private readonly retriever: MemoryRetriever,
    private readonly generator: GroundedAnswerGenerator,
    private readonly rewriter: ConversationRewriter,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly minimumRelevance = 0.5,
    private readonly executionDeadlineMs = 24_000,
  ) {}

  public async create(coupleId: string, userId: string): Promise<ConversationSummary> {
    const now = this.clock.now();
    const conversation: ConversationSummary = {
      conversationId: this.ids.next(),
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
    };
    await this.conversations.create(conversation, userId, coupleId);
    return conversation;
  }

  public list(coupleId: string, userId: string, cursor?: string, limit?: number) {
    return this.conversations.list(coupleId, userId, cursor, limit);
  }

  public async get(
    coupleId: string,
    userId: string,
    conversationId: string,
    cursor?: string,
    limit?: number,
  ): Promise<Conversation> {
    const conversation = await this.conversations.get(
      coupleId,
      userId,
      conversationId,
      cursor,
      limit,
    );
    if (conversation === null) throw new ResourceNotFoundError();
    return conversation;
  }

  public async message(
    coupleId: string,
    userId: string,
    conversationId: string,
    request: CreateMessageRequest,
  ): Promise<ChatTurn> {
    const conversation = await this.get(coupleId, userId, conversationId, undefined, 1);
    const existing = await this.conversations.findTurnByRequestId(
      coupleId,
      userId,
      conversationId,
      request.requestId,
    );
    if (existing !== null) {
      if (existing.question !== request.question) throw new ConflictError();
      if (existing.status === 'COMPLETED') return existing;
      if (existing.status === 'PENDING') throw new ConflictError();
    }
    const pending: ChatTurn = {
      turnId: existing?.turnId ?? this.ids.next(),
      requestId: request.requestId,
      question: request.question,
      ...(request.filters === undefined ? {} : { filters: request.filters }),
      status: 'PENDING',
      createdAt: existing?.createdAt ?? this.clock.now(),
    };
    await this.conversations.reserveTurn(coupleId, userId, conversationId, pending);
    const deadlineAt = Date.now() + this.executionDeadlineMs;
    try {
      const history = await this.conversations.completedTurns(coupleId, userId, conversationId, 6);
      const resolvedQuestion =
        history.length === 0
          ? request.question
          : await this.rewriter.resolve(
              request.question,
              history,
              this.remainingSignal(deadlineAt),
            );
      const evidence = (
        await this.retriever.retrieve(
          coupleId,
          resolvedQuestion,
          request.filters,
          this.remainingSignal(deadlineAt),
        )
      ).filter((memory) => memory.relevance >= this.minimumRelevance);
      const completed =
        evidence.length === 0
          ? this.completed(pending, abstention(request.question), [], true)
          : this.fromGeneration(
              pending,
              await this.generator.generate(
                request.question,
                evidence,
                this.remainingSignal(deadlineAt),
              ),
              evidence,
            );
      await this.conversations.completeTurn(coupleId, userId, conversationId, completed);
      if (conversation.title === 'New conversation') {
        await this.conversations.renameIfNew(
          coupleId,
          userId,
          conversationId,
          request.question.trim().slice(0, 120),
        );
      }
      return completed;
    } catch (error) {
      const failed: ChatTurn = {
        ...pending,
        status: 'FAILED',
        failureCode:
          error instanceof Error && error.name === 'TimeoutError'
            ? 'TIMEOUT'
            : 'DEPENDENCY_FAILURE',
      };
      await this.conversations.failTurn(coupleId, userId, conversationId, failed);
      throw error;
    }
  }

  private remainingSignal(deadlineAt: number): AbortSignal {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new DOMException('AI execution deadline exceeded.', 'TimeoutError');
    return AbortSignal.timeout(remaining);
  }

  private completed(
    turn: ChatTurn,
    answer: string,
    citations: ChatTurn['citations'],
    abstained: boolean,
  ): ChatTurn {
    return { ...turn, status: 'COMPLETED', answer, citations, abstained };
  }

  private fromGeneration(
    turn: ChatTurn,
    result: Awaited<ReturnType<GroundedAnswerGenerator['generate']>>,
    evidence: readonly RetrievedMemory[],
  ): ChatTurn {
    const byId = new Map(evidence.map((memory) => [memory.memoryId, memory]));
    if (result.abstained) return this.completed(turn, result.answer, [], true);
    const citations = result.citedMemoryIds.map((memoryId) => {
      const memory = byId.get(memoryId);
      if (memory === undefined)
        throw new Error('Generator cited memory outside supplied evidence.');
      return { memoryId, title: memory.title, relevance: memory.relevance };
    });
    if (citations.length === 0) throw new Error('Generator returned an uncited answer.');
    return this.completed(turn, result.answer, citations, false);
  }
}
