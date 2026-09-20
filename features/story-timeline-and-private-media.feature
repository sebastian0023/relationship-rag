Feature: Private shared story timeline
  Scenario: Create and order shared memories
    Given an active invited member
    When they create two memories on different dates
    Then both members can view them newest first

  Scenario: Prevent a lost update
    Given a member is editing a memory at version 2
    When the other member saves version 3 first
    Then the stale update receives a conflict asking them to reload

  Scenario: Keep media private
    Given a member requests an allowed photo upload
    When they upload a JPEG within the size limit
    Then it is private until validated processing creates a ready photo

  Scenario: Hide another couple's memory
    Given a memory belongs to another couple
    When an active member requests it
    Then the API returns 404 without memory metadata

  Scenario: Delete a memory
    Given a memory contains private photos
    When either active member deletes it
    Then it disappears from the timeline and cleanup is queued
