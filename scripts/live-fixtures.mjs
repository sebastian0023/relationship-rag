/* global process */
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds = new Set(['memory', 'conversation', 'card', 'delivery']);

export function newManifest({
  accountId,
  coupleId,
  region = 'us-east-1',
  tableName,
  mediaBucket,
  sourceBucket,
}) {
  if (!/^\d{12}$/.test(accountId) || coupleId !== 'relationship-rag-test' || region !== 'us-east-1')
    throw new Error('Live fixtures require the configured test account, couple, and region.');
  for (const value of [tableName, mediaBucket, sourceBucket])
    if (typeof value !== 'string' || value.length === 0)
      throw new Error('Missing test-stage resource.');
  const runId = randomUUID();
  return {
    version: 1,
    runId,
    tag: `verify-${runId.slice(0, 8)}`,
    accountId,
    coupleId,
    region,
    tableName,
    mediaBucket,
    sourceBucket,
    startedAt: new Date().toISOString(),
    fixtures: [],
  };
}

export function validateManifest(manifest) {
  if (
    manifest?.version !== 1 ||
    !uuid.test(manifest.runId) ||
    manifest.tag !== `verify-${manifest.runId.slice(0, 8)}` ||
    !/^\d{12}$/.test(manifest.accountId) ||
    manifest.coupleId !== 'relationship-rag-test' ||
    manifest.region !== 'us-east-1' ||
    !Array.isArray(manifest.fixtures)
  )
    throw new Error('Invalid test fixture manifest.');
  for (const name of ['tableName', 'mediaBucket', 'sourceBucket'])
    if (typeof manifest[name] !== 'string' || !manifest[name])
      throw new Error('Missing test-stage resource.');
  for (const item of manifest.fixtures) {
    if (
      !kinds.has(item.kind) ||
      !uuid.test(item.id) ||
      (item.kind !== 'memory' && (typeof item.ownerId !== 'string' || !item.ownerId)) ||
      (item.kind === 'memory' && !/^\d{4}-\d{2}-\d{2}$/.test(item.occurredOn)) ||
      (item.kind !== 'memory' &&
        (typeof item.createdAt !== 'string' || Number.isNaN(Date.parse(item.createdAt)))) ||
      (item.requestId !== undefined && !uuid.test(item.requestId)) ||
      (item.cardId !== undefined && !uuid.test(item.cardId)) ||
      (item.recipientId !== undefined && typeof item.recipientId !== 'string') ||
      (item.idempotencyKey !== undefined && !item.idempotencyKey.startsWith(manifest.tag))
    )
      throw new Error('Invalid test fixture record.');
  }
  return manifest;
}

export async function saveManifest(path, manifest) {
  validateManifest(manifest);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

export async function loadManifest(path) {
  return validateManifest(JSON.parse(await readFile(path, 'utf8')));
}

export async function recordFixture(path, item) {
  const manifest = await loadManifest(path);
  manifest.fixtures.push(item);
  await saveManifest(path, manifest);
  return manifest;
}

// Build exact partition/key targets from server-returned IDs. Never scan shared data.
export function fixtureKeys(manifest, item) {
  validateManifest({ ...manifest, fixtures: [item] });
  const couple = `COUPLE#${manifest.coupleId}`;
  if (item.kind === 'memory')
    return [
      { PK: couple, SK: `MEMORY_ID#${item.id}` },
      { PK: couple, SK: `MEMORY#${item.occurredOn}#${item.id}` },
      { PK: couple, SK: `INGESTION#${item.id}` },
      { PK: couple, SK: `INGESTION_WORK#${item.id}` },
    ];
  if (item.kind === 'conversation') {
    const PK = `${couple}#USER#${item.ownerId}`;
    return [
      { PK, SK: `CONVERSATION#${item.id}` },
      { PK, SK: `CONVERSATION_CREATED#${item.createdAt}#${item.id}` },
    ];
  }
  if (item.kind === 'card') {
    const PK = `${couple}#USER#${item.ownerId}`;
    return [
      { PK, SK: `CARD#${item.id}` },
      { PK, SK: `CARD_CREATED#${item.createdAt}#${item.id}` },
      ...(item.requestId ? [{ PK, SK: `CARD_REQUEST#${item.requestId}` }] : []),
    ];
  }
  return [
    { PK: couple, SK: `DELIVERY#${item.id}` },
    ...(item.nextAttemptAt
      ? [{ PK: couple, SK: `DELIVERY_WORK#${item.nextAttemptAt}#${item.id}` }]
      : []),
    ...(item.idempotencyKey
      ? [{ PK: couple, SK: `SEND_REQUEST#${item.ownerId}#${item.idempotencyKey}` }]
      : []),
    ...(item.cardId && item.recipientId
      ? [
          { PK: `USER#${item.recipientId}`, SK: `INBOX_CARD#${item.cardId}` },
          ...(item.deliveredAt
            ? [{ PK: `USER#${item.recipientId}`, SK: `INBOX#${item.deliveredAt}#${item.cardId}` }]
            : []),
        ]
      : []),
  ];
}

const belongsToFixture = (manifest, item, row) => {
  if (row === undefined) return true;
  if (item.kind === 'memory')
    return (
      row.memoryId === item.id &&
      (row.tags?.includes(manifest.tag) ||
        row.entityType === 'INGESTION' ||
        row.entityType === 'INGESTION_WORK')
    );
  if (item.kind === 'conversation')
    return row.entityType === 'CONVERSATION' || row.entityType === 'CONVERSATION_LISTING'
      ? row.conversationId === item.id && row.createdAt === item.createdAt
      : typeof row.SK === 'string' &&
          row.SK.startsWith(`CONVERSATION#${item.id}#`) &&
          (row.entityType === 'CHAT_TURN' || row.entityType === 'CHAT_REQUEST');
  if (item.kind === 'card')
    return (
      row.cardId === item.id &&
      (row.occasion?.includes(manifest.tag) || row.entityType === 'CARD_REQUEST')
    );
  return (
    row.deliveryId === item.id ||
    (row.cardId === item.cardId && row.deliveryId === item.id) ||
    row.response?.deliveryId === item.id
  );
};

export async function cleanupFixtures(manifest, store, confirm = false) {
  validateManifest(manifest);
  if ((await store.accountId()) !== manifest.accountId)
    throw new Error('AWS account does not match the fixture manifest.');
  const stage = await store.stageResources();
  if (
    stage.tableName !== manifest.tableName ||
    stage.mediaBucket !== manifest.mediaBucket ||
    stage.sourceBucket !== manifest.sourceBucket
  )
    throw new Error('Fixture resources do not match the existing test-stage stack.');
  const actions = [];
  // Delete conversations/cards before memories so their original citations remain inspectable.
  for (const item of [...manifest.fixtures].reverse()) {
    const keys = fixtureKeys(manifest, item);
    if (item.kind === 'memory') {
      if ((await store.get(keys[0])) !== undefined)
        throw new Error(
          `Memory ${item.id} must be deleted through the API before storage cleanup.`,
        );
      if (
        (await store.get(keys[3])) !== undefined ||
        (await store.hasCurrentObject(
          manifest.sourceBucket,
          `memories/${manifest.coupleId}/${item.id}.md`,
        ))
      )
        throw new Error(`Memory ${item.id} ingestion cleanup is still running.`);
    }
    if (item.kind === 'conversation') {
      const PK = keys[0].PK;
      keys.push(
        ...(await store.query(PK, `CONVERSATION#${item.id}#`)).map(({ PK, SK }) => ({ PK, SK })),
      );
    }
    if (item.kind === 'delivery') {
      const record = await store.get(keys[0]);
      if (record && !['DELIVERED', 'FAILED'].includes(record.status))
        throw new Error(
          `Delivery ${item.id} is still active; wait for a terminal state before cleanup.`,
        );
      if (record?.nextAttemptAt)
        keys.push({ PK: keys[0].PK, SK: `DELIVERY_WORK#${record.nextAttemptAt}#${item.id}` });
      if (record?.deliveredAt && item.recipientId && item.cardId)
        keys.push({
          PK: `USER#${item.recipientId}`,
          SK: `INBOX#${record.deliveredAt}#${item.cardId}`,
        });
    }
    for (const key of keys) {
      const row = await store.get(key);
      if (row === undefined) continue;
      if (!belongsToFixture(manifest, item, row))
        throw new Error(`Refusing to remove a record that is not part of run ${manifest.runId}.`);
      actions.push({ type: 'record', key });
    }
    if (item.kind === 'memory') {
      for (const prefix of [
        `staging/${manifest.coupleId}/${item.id}/`,
        `display/${manifest.coupleId}/${item.id}/`,
        `thumbnail/${manifest.coupleId}/${item.id}/`,
      ])
        actions.push({ type: 'object-prefix', bucket: manifest.mediaBucket, key: prefix });
      for (const key of [
        `memories/${manifest.coupleId}/${item.id}.md`,
        `memories/${manifest.coupleId}/${item.id}.md.metadata.json`,
      ])
        actions.push({ type: 'object', bucket: manifest.sourceBucket, key });
    }
    if (item.kind === 'delivery') actions.push({ type: 'schedule', name: `delivery-${item.id}` });
  }
  if (confirm) {
    for (const action of actions) {
      if (action.type === 'record') await store.remove(action.key);
      else if (action.type === 'schedule') await store.removeSchedule(action.name);
      else await store.removeCurrentObjects(action.bucket, action.key, action.type === 'object');
    }
    for (const action of actions) {
      if (action.type === 'record' && (await store.get(action.key)) !== undefined)
        throw new Error('Fixture record still exists after cleanup.');
      if (
        (action.type === 'object' || action.type === 'object-prefix') &&
        (await store.hasCurrentObjects(action.bucket, action.key, action.type === 'object'))
      )
        throw new Error('Fixture object still exists after cleanup.');
      if (action.type === 'schedule' && (await store.hasSchedule(action.name)))
        throw new Error('Fixture schedule still exists after cleanup.');
    }
  }
  return actions;
}
