import { describe, expect, it } from 'vitest';
import type { ChatTurn, Conversation, ConversationSummary } from '@relationship-rag/contracts';
import { ConflictError } from '@relationship-rag/domain';
import { ConversationService } from './conversation-service.js';
import type { ConversationRepository } from './ports.js';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const clock = { now: () => '2026-09-20T00:00:00.000Z' };

class FakeConversations implements ConversationRepository {
  readonly turns: ChatTurn[] = [];
  public async create(): Promise<void> {}
  public async renameIfNew(): Promise<void> {}
  public async list() {
    return { items: [] as ConversationSummary[] };
  }
  public async get(_couple: string, _user: string, id: string): Promise<Conversation | null> {
    return {
      conversationId: id,
      title: 'New conversation',
      createdAt: clock.now(),
      updatedAt: clock.now(),
      turns: this.turns,
    };
  }
  public async findTurnByRequestId(
    _couple: string,
    _user: string,
    _conversation: string,
    requestId: string,
  ) {
    return this.turns.find((turn) => turn.requestId === requestId) ?? null;
  }
  public async reserveTurn(_couple: string, _user: string, _conversation: string, turn: ChatTurn) {
    const index = this.turns.findIndex((item) => item.turnId === turn.turnId);
    if (index < 0) this.turns.push(turn);
    else this.turns[index] = turn;
  }
  public async completeTurn(couple: string, user: string, conversation: string, turn: ChatTurn) {
    await this.reserveTurn(couple, user, conversation, turn);
  }
  public async failTurn(couple: string, user: string, conversation: string, turn: ChatTurn) {
    await this.reserveTurn(couple, user, conversation, turn);
  }
  public async completedTurns() {
    return this.turns.filter((turn) => turn.status === 'COMPLETED');
  }
}

describe('ConversationService', () => {
  it('abstains without calling generation when retrieval has no eligible evidence', async () => {
    const repository = new FakeConversations();
    const generate = async () => {
      throw new Error('generation should not run');
    };
    const service = new ConversationService(
      repository,
      { retrieve: async () => [] },
      { generate },
      { resolve: async (question) => question },
      { next: () => ids.shift()! },
      clock,
    );
    const response = await service.message('couple', 'user', ids[0]!, {
      requestId: '33333333-3333-4333-8333-333333333333',
      question: 'What is our dog name?',
    });
    expect(response).toMatchObject({ status: 'COMPLETED', abstained: true, citations: [] });
  });

  it('creates citations only from verified evidence and replays a completed request', async () => {
    const repository = new FakeConversations();
    const service = new ConversationService(
      repository,
      {
        retrieve: async () => [
          {
            memoryId: '44444444-4444-4444-8444-444444444444',
            title: 'Anniversary',
            content: 'Oaxaca',
            relevance: 0.9,
          },
        ],
      },
      {
        generate: async () => ({
          answer: 'Oaxaca.',
          citedMemoryIds: ['44444444-4444-4444-8444-444444444444'],
          abstained: false,
        }),
      },
      { resolve: async (question) => question },
      { next: () => ids.shift()! },
      clock,
    );
    const request = {
      requestId: '55555555-5555-4555-8555-555555555555',
      question: 'Where was our anniversary?',
    };
    const first = await service.message(
      'couple',
      'user',
      '66666666-6666-4666-8666-666666666666',
      request,
    );
    const replay = await service.message(
      'couple',
      'user',
      '66666666-6666-4666-8666-666666666666',
      request,
    );
    expect(replay).toEqual(first);
    expect(first.citations?.[0]?.title).toBe('Anniversary');
  });

  it('rejects request ID reuse with different question text', async () => {
    const repository = new FakeConversations();
    repository.turns.push({
      turnId: '77777777-7777-4777-8777-777777777777',
      requestId: '88888888-8888-4888-8888-888888888888',
      question: 'First question',
      status: 'COMPLETED',
      createdAt: clock.now(),
      answer: 'Answer',
      citations: [],
      abstained: true,
    });
    const service = new ConversationService(
      repository,
      { retrieve: async () => [] },
      { generate: async () => ({ answer: '', citedMemoryIds: [], abstained: true }) },
      { resolve: async (question) => question },
      { next: () => ids.shift()! },
      clock,
    );
    await expect(
      service.message('couple', 'user', '99999999-9999-4999-8999-999999999999', {
        requestId: '88888888-8888-4888-8888-888888888888',
        question: 'Changed question',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
