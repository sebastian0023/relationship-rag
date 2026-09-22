Feature: Grounded card studio
  Scenario: Generate and save from selected memories
    Given two active members share indexed and unindexed memories
    When one member generates a card with explicitly selected memories
    Then the draft cites only those selected memories
    And generation does not save or send the card

  Scenario: Generate without memories
    When a member generates a card without selecting memories
    Then the draft contains no relationship facts
    And the draft has no citations

  Scenario: Regeneration is rejected
    Given a member has unsaved edits
    When a new generated suggestion is rejected
    Then the unsaved edits remain unchanged

  Scenario: Draft ownership and versions
    Given a member saved a draft
    When another member requests or updates that draft
    Then the service returns not found
    When the owner updates a stale version
    Then the service returns a conflict

  Scenario: Delete a draft
    Given a member saved a draft
    When the member deletes its current version
    Then it no longer appears in the card studio
