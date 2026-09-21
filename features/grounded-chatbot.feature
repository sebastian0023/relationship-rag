Feature: Ask grounded questions about shared memories

  Scenario: Answer a known memory with a citation
    Given I am an active member with a private conversation
    And an indexed shared memory says our anniversary was in Oaxaca
    When I ask where we celebrated our anniversary
    Then the response mentions Oaxaca
    And it cites that shared memory

  Scenario: Abstain when evidence is insufficient
    Given I have a private conversation with no indexed memory about our dog
    When I ask for our dog's name
    Then the response says the information is not in the shared memories
    And the response has no citations

  Scenario: Keep conversations private to their creator
    Given another active member created a conversation
    When I request that conversation
    Then the API returns 404
    And it returns no conversation metadata

  Scenario: Retry a completed request safely
    Given my message request has completed
    When I repeat it with the same request ID and question
    Then I receive the stored answer
    And no duplicate turn is created
