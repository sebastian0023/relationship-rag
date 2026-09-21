export interface RetrievedMemory {
  readonly memoryId: string;
  readonly title: string;
  readonly content: string;
  readonly relevance: number;
}

export interface MemoryRetrievalFilters {
  readonly occurredOnFrom?: string;
  readonly occurredOnTo?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
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
