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

  it('uses completed context to rewrite follow-up retrieval queries', async () => {
    const repository = new FakeConversations();
    repository.turns.push({
      turnId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      question: 'Where was our anniversary?',
      status: 'COMPLETED',
      createdAt: clock.now(),
      answer: 'Oaxaca.',
      citations: [],
      abstained: true,
    });
    let retrievalQuery = '';
    const service = new ConversationService(
      repository,
      {
        retrieve: async (_coupleId, query) => {
          retrievalQuery = query;
          return [];
        },
      },
      { generate: async () => ({ answer: '', citedMemoryIds: [], abstained: true }) },
      { resolve: async () => 'When was our anniversary in Oaxaca?' },
      { next: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      clock,
    );

    await service.message('couple', 'user', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', {
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      question: 'When was that?',
    });
    expect(retrievalQuery).toBe('When was our anniversary in Oaxaca?');
  });

  it('records safe failure state when generation times out', async () => {
    const repository = new FakeConversations();
    const timeout = Object.assign(new Error('deadline exceeded'), { name: 'TimeoutError' });
    const service = new ConversationService(
      repository,
      {
        retrieve: async () => [
          {
            memoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            title: 'Memory',
            content: 'text',
            relevance: 1,
          },
        ],
      },
      { generate: async () => Promise.reject(timeout) },
      { resolve: async (question) => question },
      { next: () => '12121212-1212-4121-8121-121212121212' },
      clock,
    );

    await expect(
      service.message('couple', 'user', '13131313-1313-4131-8131-131313131313', {
        requestId: '14141414-1414-4141-8141-141414141414',
        question: 'What happened?',
      }),
    ).rejects.toBe(timeout);
    expect(repository.turns.at(-1)).toMatchObject({ status: 'FAILED', failureCode: 'TIMEOUT' });
  });

  it('does not start another dependency call after the shared deadline', async () => {
    const repository = new FakeConversations();
    repository.turns.push({
      turnId: '20202020-2020-4020-8020-202020202020',
      requestId: '21212121-2121-4121-8121-212121212121',
      question: 'Earlier question',
      status: 'COMPLETED',
      createdAt: clock.now(),
      answer: 'Earlier answer',
      citations: [],
      abstained: true,
    });
    let retrievalCalled = false;
    const service = new ConversationService(
      repository,
      {
        retrieve: async () => {
          retrievalCalled = true;
          return [];
        },
      },
      { generate: async () => ({ answer: '', citedMemoryIds: [], abstained: true }) },
      {
        resolve: async (question) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return question;
        },
      },
      { next: () => '22222222-2222-4222-8222-222222222223' },
      clock,
      0.5,
      1,
    );

    await expect(
      service.message('couple', 'user', '23232323-2323-4232-8232-232323232323', {
        requestId: '24242424-2424-4242-8242-242424242424',
        question: 'Follow up?',
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(retrievalCalled).toBe(false);
    expect(repository.turns.at(-1)).toMatchObject({ status: 'FAILED', failureCode: 'TIMEOUT' });
  });

  it('rejects fabricated citations and stores a dependency failure', async () => {
    const repository = new FakeConversations();
    const service = new ConversationService(
      repository,
      {
        retrieve: async () => [
          {
            memoryId: '15151515-1515-4151-8151-151515151515',
            title: 'Memory',
            content: 'text',
            relevance: 1,
          },
        ],
      },
      {
        generate: async () => ({
          answer: 'Unsupported.',
          citedMemoryIds: ['16161616-1616-4161-8161-161616161616'],
          abstained: false,
        }),
      },
      { resolve: async (question) => question },
      { next: () => '17171717-1717-4171-8171-171717171717' },
      clock,
    );

    await expect(
      service.message('couple', 'user', '18181818-1818-4181-8181-181818181818', {
        requestId: '19191919-1919-4191-8191-191919191919',
        question: 'What happened?',
      }),
    ).rejects.toThrow('outside supplied evidence');
    expect(repository.turns.at(-1)).toMatchObject({
      status: 'FAILED',
      failureCode: 'DEPENDENCY_FAILURE',
    });
  });
});
