Feature: Nuestra historia web experience
  Scenario: Enter through the secure hosted sign-in
    Given a visitor opens the welcome page
    When they choose «Entrar a nuestro espacio»
    Then they see «Te llevamos al acceso seguro…» before the hosted sign-in opens

  Scenario: Session expiry keeps the member's place
    Given an active member is viewing a memory
    When the API rejects their session after a silent refresh
    Then they see «Tu sesión terminó»
    And «Volver a entrar» returns them to the same memory after sign-in

  Scenario: An account without membership sees no private data
    Given a signed-in account has no active membership
    When any API request returns 403
    Then they see «Este espacio es privado» with no account or couple details

  Scenario: Sign out returns to the welcome page
    Given an active member is signed in
    When they choose «Cerrar sesión»
    Then the local session is cleared and the hosted logout runs
    And the welcome page confirms «Cerraste sesión. Hasta pronto.»

  Scenario: Save a memory with validation
    Given a member opens «Añadir recuerdo»
    When they save without a title or text
    Then an error summary and field errors explain what to fix
    And their typed values remain

  Scenario: A concurrent edit never overwrites local text
    Given a member edits a memory at version 2
    And their partner saved version 3
    When the member saves
    Then a conflict panel shows both versions
    And only «Guardar mi versión y reemplazar la suya» saves against version 3

  Scenario: Leaving unsaved changes asks first
    Given a member changed a memory or a card draft
    When they navigate away
    Then «¿Salir sin guardar?» lets them keep editing or discard

  Scenario: Unsupported photos are explained before upload
    Given a member adds a HEIC photo or a file over 10 MiB
    Then nothing is uploaded
    And the panel explains how to choose a compatible JPEG, PNG, or WebP file

  Scenario: Photo upload progress is visible
    Given a member uploads a valid JPEG
    Then the photo shows upload progress and then «Procesando…»
    And a failed upload offers «Reintentar» and «Quitar»

  Scenario: Grounded answers show their memories
    Given a memory is available for conversation
    When a member asks about it
    Then the answer lists the supporting memory as a link

  Scenario: Abstention is explicit
    Given no available memory supports a question
    When a member asks it
    Then the answer says there is no supporting memory and lists none

  Scenario: Retrying a question does not duplicate it
    Given a question failed to get an answer
    When the member chooses «Reintentar»
    Then the same request ID is sent again

  Scenario: AI proposals never replace a draft silently
    Given a member wrote a card message
    When they generate a proposal and choose «Usar esta propuesta»
    Then they must confirm the replacement before their message changes

  Scenario: Only the saved version can be sent
    Given a card draft has unsaved changes
    When the member opens the review screen
    Then confirmation is disabled until the changes are saved

  Scenario: Delivery status comes from the server
    Given a member confirmed an immediate send
    Then the result shows «En cola» until the server reports «Enviada»

  Scenario: Invalid schedules are blocked
    Given a member schedules a card
    When they choose a past time or a time that does not exist because of daylight saving
    Then confirmation is blocked with an explanation

  Scenario: Reading a letter marks it read
    Given a member has an unread card in the inbox
    When they open it
    Then the envelope animation can be skipped
    And the unread count decreases and the change is announced

  Scenario: Reduced motion
    Given the system prefers reduced motion
    Then kittens are still and letters open without animation
