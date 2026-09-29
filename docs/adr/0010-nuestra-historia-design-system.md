# ADR 0010: “Nuestra historia” design system in the Angular client

- Status: Accepted
- Date: 2026-09-29

## Context

A complete visual and interaction design for the web client exists in Claude Design (“Nuestra
historia design system”). It specifies Spanish copy, tokens, two typefaces, kitten illustrations,
modal panels, and Spanish route names. It also suggests CDK Dialog for panels. The product is
private and invite-only, and the existing routes, Cognito callback, and logout URLs are already
deployed.

## Decision

- Implement the design in the existing standalone Angular app (ADR 0001) with Tailwind v4 `@theme`
  tokens (`marfil`, `papel`, `ciruela`, `accion`, `rosa`, `salvia`, `lavanda`, `durazno`, `error`,
  `borde`) and a small `@layer components` vocabulary (`nh-btn-*`, `nh-campo`, `nh-panel`).
- Write all UI copy in Spanish, but **keep the existing English route paths**. This avoids breaking
  bookmarks, the Cognito callback, and the logout URL.
- **Self-host** Figtree and Newsreader through `@fontsource-variable` packages, so no page load
  contacts a third-party font CDN.
- Build panels on the **native `<dialog>`** instead of adding `@angular/cdk`. `showModal()` provides
  the focus trap, Escape, inert background, and backdrop. The component restores focus to the
  opener.
- Port the kitten illustrations to Angular SVG templates, not `innerHTML`, so no sanitizer bypass
  is needed.
- Load feature routes lazily to keep the initial bundle within budget.
- Replace the three duplicated `fetch` wrappers with one `ApiClient`. It maps `401` to the
  session-expired screen and `403` to the access-denied screen, and it exposes only status, code,
  and correlation ID.

## Consequences

Managed-login pages still use Cognito's default look until a separate infrastructure change
brands them. UI copy is not externalised for translation. Adding English later requires extracting
strings. Contributors should reuse the `ui/` components and tokens rather than introduce new
colours or dialog implementations.
