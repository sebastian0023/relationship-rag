import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanupFixtures, fixtureKeys, newManifest, validateManifest } from './live-fixtures.mjs';

const setup = () =>
  newManifest({
    accountId: '123456789012',
    coupleId: 'relationship-rag-test',
    region: 'us-east-1',
    tableName: 'table-test',
    mediaBucket: 'media-test',
    sourceBucket: 'source-test',
  });
const id = '11111111-1111-4111-8111-111111111111';

describe('live fixture cleanup', () => {
  it('rejects a non-test couple and malformed records', () => {
    assert.throws(() => newManifest({ ...setup(), coupleId: 'personal' }));
    const manifest = setup();
    manifest.fixtures.push({ kind: 'memory', id, occurredOn: '2025-01-01' });
    validateManifest(manifest);
    manifest.fixtures.push({ kind: 'card', id: 'not-an-id', ownerId: 'owner', createdAt: 'bad' });
    assert.throws(() => validateManifest(manifest));
  });

  it('plans exact keys and deletes only tagged test records', async () => {
    const manifest = setup();
    const memory = { kind: 'memory', id, occurredOn: '2025-01-01' };
    manifest.fixtures.push(memory);
    const rows = new Map();
    const keyOf = ({ PK, SK }) => `${PK}|${SK}`;
    const key = fixtureKeys(manifest, memory)[2];
    rows.set(keyOf(key), { ...key, entityType: 'INGESTION', memoryId: id });
    rows.set('COUPLE#relationship-rag-test|MEMORY_ID#other', { title: 'Personal' });
    const removed = [];
    const store = {
      accountId: async () => manifest.accountId,
      stageResources: async () => manifest,
      get: async (key) => rows.get(keyOf(key)),
      query: async () => [],
      hasCurrentObject: async () => false,
      remove: async (key) => {
        removed.push(keyOf(key));
        rows.delete(keyOf(key));
      },
      removeSchedule: async () => {},
      hasSchedule: async () => false,
      removeCurrentObjects: async () => {},
      hasCurrentObjects: async () => false,
    };
    const planned = await cleanupFixtures(manifest, store, false);
    assert.equal(planned.filter((action) => action.type === 'record').length, 1);
    assert.equal(removed.length, 0);
    await cleanupFixtures(manifest, store, true);
    assert.deepEqual(removed, [keyOf(key)]);
    assert.equal(rows.has('COUPLE#relationship-rag-test|MEMORY_ID#other'), true);
    await cleanupFixtures(manifest, store, true);
  });

  it('refuses wrong account, untagged data, and an active delivery', async () => {
    const manifest = setup();
    const memory = { kind: 'memory', id, occurredOn: '2025-01-01' };
    manifest.fixtures.push(memory);
    const key = fixtureKeys(manifest, memory)[2];
    const store = {
      accountId: async () => '000000000000',
      stageResources: async () => manifest,
      get: async (requested) =>
        requested.SK === key.SK ? { ...key, memoryId: 'other', tags: [] } : undefined,
      query: async () => [],
      hasCurrentObject: async () => false,
    };
    await assert.rejects(cleanupFixtures(manifest, store, true), /account/);
    store.accountId = async () => manifest.accountId;
    store.stageResources = async () => ({ ...manifest, tableName: 'another-table' });
    await assert.rejects(cleanupFixtures(manifest, store, true), /test-stage stack/);
    store.stageResources = async () => manifest;
    await assert.rejects(cleanupFixtures(manifest, store, true), /Refusing/);
    manifest.fixtures = [
      { kind: 'delivery', id, ownerId: 'owner', createdAt: new Date().toISOString() },
    ];
    store.get = async () => ({ deliveryId: id, status: 'PENDING' });
    await assert.rejects(cleanupFixtures(manifest, store, true), /still active/);
  });

  it('removes exact delivered-card and inbox rows while preserving another card', async () => {
    const manifest = setup();
    const cardId = '22222222-2222-4222-8222-222222222222';
    const deliveryId = '33333333-3333-4333-8333-333333333333';
    const requestId = '44444444-4444-4444-8444-444444444444';
    const createdAt = '2025-05-10T12:00:00.000Z';
    const deliveredAt = '2025-05-10T12:01:00.000Z';
    const card = { kind: 'card', id: cardId, ownerId: 'owner-1', createdAt, requestId };
    const delivery = {
      kind: 'delivery',
      id: deliveryId,
      cardId,
      ownerId: 'owner-1',
      recipientId: 'partner-1',
      createdAt,
      idempotencyKey: `${manifest.tag}-key`,
    };
    manifest.fixtures.push(card, delivery);
    const rows = new Map();
    const keyOf = ({ PK, SK }) => `${PK}|${SK}`;
    const put = (key, row) => rows.set(keyOf(key), { ...key, ...row });
    const [cardKey, listingKey, requestKey] = fixtureKeys(manifest, card);
    for (const key of [cardKey, listingKey])
      put(key, { entityType: 'CARD', cardId, occasion: `${manifest.tag} occasion` });
    put(requestKey, { entityType: 'CARD_REQUEST', cardId });
    const [deliveryKey, sendKey, inboxKey] = fixtureKeys(manifest, delivery);
    put(deliveryKey, {
      entityType: 'DELIVERY',
      deliveryId,
      cardId,
      status: 'DELIVERED',
      deliveredAt,
    });
    put(sendKey, { entityType: 'SEND_REQUEST', response: { deliveryId } });
    put(inboxKey, { entityType: 'INBOX', deliveryId, cardId });
    put(
      { PK: 'USER#partner-1', SK: `INBOX#${deliveredAt}#${cardId}` },
      { entityType: 'INBOX', deliveryId, cardId },
    );
    const personalKey = 'COUPLE#relationship-rag-test#USER#owner-1|CARD#personal';
    rows.set(personalKey, { title: 'Personal card' });
    const schedules = [];
    const store = {
      accountId: async () => manifest.accountId,
      stageResources: async () => manifest,
      get: async (key) => rows.get(keyOf(key)),
      query: async () => [],
      remove: async (key) => {
        rows.delete(keyOf(key));
      },
      removeSchedule: async (name) => {
        schedules.push(name);
      },
      hasSchedule: async () => false,
    };
    await cleanupFixtures(manifest, store, true);
    assert.equal(rows.size, 1);
    assert.equal(rows.get(personalKey).title, 'Personal card');
    assert.deepEqual(schedules, [`delivery-${deliveryId}`]);
  });

  it('rejects cleanup that leaves a test schedule behind', async () => {
    const manifest = setup();
    manifest.fixtures.push({
      kind: 'delivery',
      id,
      ownerId: 'owner-1',
      createdAt: '2025-05-10T12:00:00.000Z',
    });
    const store = {
      accountId: async () => manifest.accountId,
      stageResources: async () => manifest,
      get: async () => undefined,
      removeSchedule: async () => {},
      hasSchedule: async () => true,
    };
    await assert.rejects(cleanupFixtures(manifest, store, true), /schedule still exists/);
  });
});
