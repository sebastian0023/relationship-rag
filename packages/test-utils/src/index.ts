export interface TestActor {
  readonly userId: string;
  readonly coupleId: string;
  readonly role: 'OWNER' | 'PARTNER';
}

export const buildActor = (overrides: Partial<TestActor> = {}): TestActor => ({
  userId: 'user-test-owner',
  coupleId: 'couple-test',
  role: 'OWNER',
  ...overrides,
});
