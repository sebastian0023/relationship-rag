Feature: Private RAG ingestion
  Scenario: A new memory is indexed without exposing its text
    Given an active member creates a shared memory
    When the ingestion coordinator completes its batch
    Then the memory reports INDEXED
    And its source document is scoped to the member's couple

  Scenario: An older indexing job cannot overwrite an edit
    Given a memory is pending indexing
    When a member edits the memory before the job completes
    Then the older completion does not mark the edited memory indexed

  Scenario: A member retries failed indexing
    Given a memory has FAILED ingestion status
    When an active member requests reindexing
    Then the API accepts the request and reports PENDING

  Scenario: Retrieval never returns another couple's memory
    Given two couples have indexed memories
    When one couple retrieves a semantic query
    Then only that couple's current memories are returned
