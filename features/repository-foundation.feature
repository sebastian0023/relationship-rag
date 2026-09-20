Feature: Repository foundation

  Scenario: Verify a clean checkout
    Given a supported Node.js and npm version
    When a contributor installs from the lockfile
    And runs the repository verification command
    Then formatting, linting, type checking, tests, builds, and CDK synthesis pass

  Scenario: Synthesize an ephemeral stage
    Given the "dev" stage configuration
    When the infrastructure application is synthesized
    Then all stack names include the stage
    And stateful resources are configured for development cleanup

  Scenario: Protect production data
    Given the "prod" stage configuration
    When the infrastructure application is synthesized
    Then stateful resources are retained
    And deletion protection is enabled where supported
