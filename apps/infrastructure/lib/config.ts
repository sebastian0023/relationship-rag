import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type StageName = 'dev' | 'test' | 'prod';

export interface StageConfig {
  readonly stage: StageName;
  readonly deletionProtection: boolean;
  readonly retainData: boolean;
  readonly logRetentionDays: number;
  readonly monthlyBudgetUsd: number;
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
    deletionProtection: requireBoolean(record, 'deletionProtection'),
    retainData: requireBoolean(record, 'retainData'),
    logRetentionDays: requirePositiveNumber(record, 'logRetentionDays'),
    monthlyBudgetUsd: requirePositiveNumber(record, 'monthlyBudgetUsd'),
  };

  if (stage === 'prod' && (!config.deletionProtection || !config.retainData)) {
    throw new Error('Production must enable deletion protection and data retention.');
  }

  return config;
};
