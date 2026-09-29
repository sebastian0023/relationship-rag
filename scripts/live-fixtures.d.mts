export interface FixtureManifest {
  version: 1;
  runId: string;
  tag: string;
  accountId: string;
  coupleId: string;
  region: string;
  tableName: string;
  mediaBucket: string;
  sourceBucket: string;
  startedAt: string;
  fixtures: Record<string, unknown>[];
}

export function newManifest(input: {
  accountId: string;
  coupleId: string;
  region: string;
  tableName: string;
  mediaBucket: string;
  sourceBucket: string;
}): FixtureManifest;
export function saveManifest(path: string, manifest: FixtureManifest): Promise<void>;
export function loadManifest(path: string): Promise<FixtureManifest>;
export function recordFixture(
  path: string,
  item: Record<string, unknown>,
): Promise<FixtureManifest>;
