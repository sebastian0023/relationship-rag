import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type StageName = 'dev' | 'test' | 'prod';

export interface StageConfig {
  readonly stage: StageName;
  readonly coupleId: string;
  readonly deletionProtection: boolean;
  readonly retainData: boolean;
  readonly logRetentionDays: number;
  readonly monthlyBudgetUsd: number;
  readonly apiRateLimit: number;
  readonly apiBurstLimit: number;
  readonly aiReservedConcurrency: number;
  readonly aiDeadlineMs: number;
  readonly backupRetentionDays: number;
}

const isStageName = (value: string): value is StageName =>
  value === 'dev' || value === 'test' || value === 'prod';

const requireBoolean = (record: Record<string, unknown>, key: string): boolean => {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`Stage config field ${key} must be a boolean.`);
  return value;
};

const requirePositiveNumber = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];
  if (typeof value !== 'number' || value <= 0) {
    throw new Error(`Stage config field ${key} must be a positive number.`);
  }
  return value;
};

const requireNonEmptyString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Stage config field ${key} must be a non-empty string.`);
  }
  return value;
};

export const loadStageConfig = (stage: string): StageConfig => {
  if (!isStageName(stage)) {
    throw new Error(`Unknown stage "${stage}". Expected dev, test, or prod.`);
  }

  const configPath = resolve(import.meta.dirname, '../../../../config/stages', `${stage}.json`);
  const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stage config ${stage} must be a JSON object.`);
  }

  const record = parsed as Record<string, unknown>;
  if (record['stage'] !== stage) throw new Error(`Stage config must declare stage "${stage}".`);

  const config: StageConfig = {
    stage,
    coupleId: requireNonEmptyString(record, 'coupleId'),
    deletionProtection: requireBoolean(record, 'deletionProtection'),
    retainData: requireBoolean(record, 'retainData'),
    logRetentionDays: requirePositiveNumber(record, 'logRetentionDays'),
    monthlyBudgetUsd: requirePositiveNumber(record, 'monthlyBudgetUsd'),
    apiRateLimit: requirePositiveNumber(record, 'apiRateLimit'),
    apiBurstLimit: requirePositiveNumber(record, 'apiBurstLimit'),
    aiReservedConcurrency: requirePositiveNumber(record, 'aiReservedConcurrency'),
    aiDeadlineMs: requirePositiveNumber(record, 'aiDeadlineMs'),
    backupRetentionDays: requirePositiveNumber(record, 'backupRetentionDays'),
  };

  for (const [key, value] of [
    ['apiBurstLimit', config.apiBurstLimit],
    ['aiReservedConcurrency', config.aiReservedConcurrency],
    ['aiDeadlineMs', config.aiDeadlineMs],
    ['backupRetentionDays', config.backupRetentionDays],
  ] as const) {
    if (!Number.isInteger(value)) throw new Error(`Stage config field ${key} must be an integer.`);
  }

  if (config.aiDeadlineMs >= 28_000)
    throw new Error('AI deadline must leave time before the Lambda timeout.');

  if (stage === 'prod' && (!config.deletionProtection || !config.retainData)) {
    throw new Error('Production must enable deletion protection and data retention.');
  }

  return config;
};
