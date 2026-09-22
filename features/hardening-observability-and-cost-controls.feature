Feature: Operate the private application safely

  Scenario: Correlate a handled dependency failure without private content
    Given a synthetic chat request whose model dependency fails
    When the API returns a retryable failure
    Then the response exposes a correlation ID
    And the dependency failure metric increases
    And no question, memory, prompt, token, or model output appears in telemetry

  Scenario: Alert on an asynchronous record failure
    Given a synthetic delivery message cannot be processed
    When the worker returns a partial batch failure
    Then the delivery failure metric increases
    And the alert notification identifies only the stage, service, and safe failure code

  Scenario: Prevent unbounded AI work
    Given a chat request reaches its shared execution deadline
    When another model operation would exceed the remaining time
    Then the operation is canceled
    And the turn records a retryable timeout failure
    And no additional model request is sent

  Scenario: Restore critical data after accidental loss
    Given synthetic test-stage records and private media are protected
    When maintainers perform the documented same-region restore drill
    Then the restored resources contain the expected critical records
    And private media remains private
    And delivery stays disabled until reconciliation completes
    And the drill finishes within four hours

  Scenario: Use the complete experience without a mouse
    Given the application is displayed at 320 pixels wide
    When an authenticated user navigates the primary journeys using only a keyboard
    Then focus remains visible and follows a logical order
    And status and error changes are announced
    And sending a card still requires explicit confirmation

  Scenario: Warn before the monthly budget is exhausted
    Given the stage budget and a confirmed operator subscription
    When actual spend reaches 80 percent of the monthly budget
    Then the operator receives the stage-specific budget notification
    And application access is not disabled automatically

