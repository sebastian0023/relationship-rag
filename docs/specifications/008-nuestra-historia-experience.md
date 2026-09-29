# Specification: “Nuestra historia” web experience

## Outcome

Both members use one calm, Spanish-language web client, “Nuestra historia”. It follows the
“Nuestro pequeño rincón” design: ivory paper, plum text and actions, Newsreader and Figtree, printed
photos, envelopes, and a white kitten and an orange kitten. Every existing capability stays
reachable on phones (from 320 px), tablets, and desktops: the welcome page and session states,
memories and photos, grounded conversations, the card studio with review and delivery, and the
inbox.

The design source is the Claude Design project “Nuestra historia design system”, file
`Nuestra historia.dc.html`, including its implementation notes.

## Non-goals

- Cognito-hosted screens (sign-in, first password, and password recovery) are not rebuilt in the
  app. Managed-login branding (Spanish language, `#8B3E55`, logo, and borders) is a follow-up
  infrastructure change.
- English UI copy and runtime language switching. Memory and card _content_ remains English or
  Spanish, as before.
- Renaming routes. The existing English paths stay: `/login`, `/app/timeline`, `/app/chat`,
  `/app/cards`, and `/app/inbox`.
- HEIC conversion, photo reordering, swipe gestures, and conversation message counts, which the
  contracts do not provide.
- New backend endpoints, schemas, or client telemetry.

## Invariants

- Generated card text enters the draft only after «Usar esta propuesta». Sending always requires
  the separate review screen and «Confirmar envío». Generation never sends.
- Chat answers show their supporting memories. Abstentions say that no memory supports the answer
  and show no invented detail.
- After confirmation, the card shows the server status (`QUEUED`, `SCHEDULED`, `SENT`, or
  `DELIVERY_FAILED`) and polls while queued. The client never assumes «Enviada».
- Each save, question, and send confirmation disables its button while in flight. A retried
  question reuses its `requestId`, and a retried confirmation reuses its idempotency key.
- A stale memory save (`409`) opens a conflict panel without overwriting the local text. Replacing
  the other version requires an explicit choice and uses the freshly loaded `version`.
- Forms with unsaved changes ask before navigation discards them.
- The UI never renders API error messages, tokens, internal IDs, or signed URLs. Failures use
  Spanish copy chosen by HTTP status. The correlation ID appears only as a secondary support
  reference.
- The client logs nothing that contains memory text, card text, questions, prompts, or tokens.
- Kittens and decorations are `aria-hidden`. Their meaning is always also written as text.
  `prefers-reduced-motion` makes all animation static. Animation pauses when the tab is hidden or
  the drawing is off screen.

## Screens and state

Every list or resource uses one of these states: loading, ready, empty, or error. The error state
has «Reintentar» and an optional reference.

| Route                          | Screen                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `/login`                       | Welcome, then the transit screen «Te llevamos al acceso seguro…», then Cognito        |
| `/auth/callback`               | Sign-in completion, then «Hola de nuevo, {nombre}.»                                   |
| `/session-expired`             | Sleeping kittens and «Volver a entrar», which returns to where the member was         |
| `/access-denied`               | «Este espacio es privado», with no account details                                    |
| `/app/timeline`                | Memories grouped by month, with cursor pagination                                     |
| `/app/timeline/new`, `…/edit`  | Memory form: counters from 80 %, error summary, tags, content language                |
| `/app/timeline/:id`            | Memory detail: photos (upload progress, processing, failure), viewer, AI availability |
| `/app/chat`, `/app/chat/:id`   | Conversation: history, filters, citations, abstention, and retry                      |
| `/app/cards`                   | Card list with status pills                                                           |
| `/app/cards/new`, `/:id`       | Draft editor with AI help, reference memories, and preview                            |
| `/app/cards/:id/review`        | Review the saved version, then send now or schedule                                   |
| `/app/cards/:id/view`          | Read-only card. With `?confirmed=1`, the delivery result with live status             |
| `/app/inbox`, `/app/inbox/:id` | Inbox with unread count, then the letter with the envelope animation and read receipt |

Navigation depends on width:

- Below 768 px: a header with a session button, and a bottom navigation that hides while the
  on-screen keyboard is open.
- 768–1023 px: an icon rail with labels.
- From 1024 px: a sidebar.

The active section uses `aria-current="page"`, bold text, and a pink pill, never colour alone. The
inbox entry carries the unread count.

## Failures

| Condition                            | Behaviour                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `401` after one silent refresh       | Clear the local session and open `/session-expired?returnTo=…`                          |
| `403` (inactive membership)          | Clear the local session and open `/access-denied`                                       |
| `404`                                | «Este recuerdo ya no está disponible» or the equivalent. Cross-couple data stays hidden |
| `409` on a memory save               | Conflict panel. On a card, reload the saved version                                     |
| Network failure or offline           | A banner and error toasts that keep the typed text                                      |
| Photo type, size, or HEIC            | Rejected before upload with Spanish guidance, including the iPhone «Más compatible» tip |
| Scheduled time in the past or at DST | Blocked on the review screen with a specific message in the viewer's time zone          |

## Accessibility

- One global `aria-live="polite"` region announces saves, uploads, answers, and read receipts.
- Panels use the native modal `<dialog>`: they trap focus, close with Escape, have a visible close
  button, and return focus to the opener.
- The photo viewer supports the arrow keys and has «Anterior» and «Siguiente» buttons.
- Invalid fields use `aria-invalid` and `aria-describedby`, and forms start with an error summary.
- Touch targets are at least 44 px and inputs use 16 px text.
- There is no horizontal overflow at 320 px. There are no serious or critical axe violations.

## Telemetry

The client adds no telemetry. Server-side metrics and correlation IDs are unchanged.
