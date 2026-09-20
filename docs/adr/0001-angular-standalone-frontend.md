# ADR 0001: Angular standalone frontend

- Status: Accepted
- Date: 2026-09-20

## Context

The product needs a responsive, accessible web client with strong TypeScript support, structured
routing, testable UI state, and a credible portfolio architecture.

## Decision

Use Angular standalone components, Signals for local state, RxJS for asynchronous streams, and
Tailwind CSS for styling. Lazy route boundaries will follow product features.

## Consequences

The client has an opinionated application structure and first-party tooling. Contributors must avoid
duplicating server authorization rules in the UI and keep API schemas in the contracts package.
