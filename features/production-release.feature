Feature: Verified production release
  Scenario: Candidate eligibility
    Given an exact commit reachable from main and checksummed release assets
    When all deterministic, security, deployed acceptance and live RAG gates pass
    Then the candidate is eligible for operational review

  Scenario Outline: Fail closed before promotion
    Given a candidate with <defect>
    When production promotion is requested
    Then deployment is blocked
    Examples:
      | defect |
      | missing phase 7 evidence |
      | a modified bundle |
      | an evidence commit mismatch |
      | a failed release gate |
      | unavailable required-reviewer protection |
      | no rollback rehearsal |

  Scenario: Publish without breaking an open session
    Given a user has loaded the previous frontend
    When a new verified frontend is published
    Then old fingerprinted assets remain available
    And HTML and runtime configuration are not cached
    And invalidation completes before smoke testing

  Scenario: Live acceptance protects privacy and grounding
    Given synthetic invited users and a foreign-couple decoy in test
    When real authentication, media, ingestion, chat, cards and delivery are exercised
    Then foreign content is inaccessible
    And unknown facts cause abstention
    And cards require explicit send confirmation and arrive exactly once
    And retained evidence excludes content and authentication secrets

  Scenario: Approve the concrete release
    Given successful release and operational evidence bound to the candidate digest
    And a production CDK diff ready for review
    When the maintainer approves the protected production deployment
    Then the reviewed candidate assets are deployed
    And automatic production smoke checks perform no data writes

  Scenario: Invite and onboard the two users
    Given the approved production deployment has passed read-only smoke tests
    When the operator explicitly provisions OWNER and PARTNER invitations
    And users enter, review and index their first memories through the UI
    Then onboarding is recorded without storing private content in the release report

  Scenario: Recover from an application regression
    Given a retained verified release bundle
    When the operator rolls back application code and frontend entrypoints
    Then memories, identities, queues and schedules remain intact
    And smoke checks pass before access resumes

  Scenario: Accept the first release
    Given onboarding, alarm confirmation and private grounding review are complete
    And 24 hours of observation passed without unresolved release failures
    When the maintainer finalizes the deployed commit
    Then that exact commit is tagged v1.0.0 with sanitized release notes
