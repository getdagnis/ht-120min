# Plan: TournamentView Refactoring & Chat Implementation

## Objective

Split the monolithic `TournamentView.tsx` into smaller, manageable components and implement a Hattrick-style chat interface.

## Scope & Impact

- Refactoring `TournamentView.tsx` into sub-components for each tab (Standings, Fixtures, Chat, News/Announcements, Admin).
- Implementing new chat UI with message bubbles, manager profiles, and emoji picker.
- Maintaining current functionality while improving maintainability.

## Implementation Plan

### Phase 1: Splitting `TournamentView.tsx`

- Create `src/components/TournamentTabs/` directory.
- Create components: `StandingsView.tsx`, `FixturesView.tsx`, `ChatView.tsx`, `AdminView.tsx`.
- Move tab-specific state and logic from `TournamentView.tsx` to these components.
- Use a `context` or pass props from `TournamentView` to manage shared tournament state (e.g., `tournament`, `teams`, `rounds`).

### Phase 2: Chat UI Enhancement

- Redesign `ChatView.tsx` to match Hattrick style:
  - Left/right message alignment.
  - Manager name with profile link.
  - Full-width input.
  - Emoji picker integration.
- Ensure chat access restriction: only logged-in Hattrick managers can chat.

### Phase 3: Verification

- Verify all tabs still render correctly.
- Ensure state synchronization works across components.
- Test chat messaging functionality.

## Alternatives Considered

- _Keep monolithic file_: Unfeasible given its size (3000+ lines).
- _Move all state to Context_: Better for prop drilling, but requires significant setup. Will use props/hooks first to minimize breaking changes.
