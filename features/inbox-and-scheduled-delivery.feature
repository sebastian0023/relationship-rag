Feature: Explicit and reliable card delivery
  Scenario: Confirmation is required
    Given a member saved a card draft
    When the member leaves the confirmation preview
    Then no delivery is accepted

  Scenario: Immediate delivery
    Given a member confirms the current saved card
    When delivery processing completes
    Then the recipient sees exactly one unread inbox item
    And the sender sees the card as sent

  Scenario: Scheduled delivery
    Given a member confirms a future delivery time with an explicit offset
    Then the recipient cannot access the card before it is due
    When the one-time schedule runs at or after that minute
    Then the recipient sees the card

  Scenario: Duplicate processing
    Given an approved delivery has already completed
    When the queue delivers the same delivery event again
    Then no second inbox item is created

  Scenario: Failed delivery is recoverable
    Given delivery retries are exhausted
    Then the sender sees delivery failed
    And a maintainer can replay the original delivery identifier
