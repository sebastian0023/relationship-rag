Feature: Secure platform and authentication
  The relationship archive is available only to the invited couple.

  Scenario: An invited active member reaches the protected application
    Given an active OWNER membership for the verified Cognito subject
    When the subject completes Cognito managed login with the API scope
    Then GET /me returns that member profile
    And the browser shows the protected application shell

  Scenario: An unauthenticated visitor opens a protected route
    Given no active browser session
    When the visitor opens /app
    Then the browser starts managed login and preserves the internal return path

  Scenario: An expired token cannot reach the profile endpoint
    Given an expired access token
    When the browser requests GET /me
    Then the API rejects the request
    And the browser clears its local session and starts login

  Scenario: A Cognito account without an active membership is denied
    Given a verified Cognito subject without an active membership
    When the subject requests GET /me
    Then the API responds with a generic forbidden error
    And no couple metadata is disclosed

  Scenario: Public signup is not available
    Given the Cognito managed login page
    When a visitor tries to register an account
    Then no self-registration path is available
