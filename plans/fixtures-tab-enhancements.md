# Plan: Fixtures Tab Enhancements

Update tournament fixture management, UI, and copy-to-clipboard functionality.

## Objective

1. **Accurate Completion Stats**: Include "misarranged" matches in finished count on home page cards.
2. **Round Finalization**: Replace the refresh button with a Copy icon/text for finished rounds.
3. **Upcoming Round UI**: Improve "upcoming round" status display with Copy icon/text + Tooltip for Hattrick forum formatting.

## Proposed Changes

### 1. Stats Update (`src/pages/Home/Home.tsx`)

- Modify `completedMatches` calculation to include `status === 'misarranged'`.

### 2. UI Updates (`src/pages/Public/TournamentView.tsx`)

- Update logic inside `rounds.map` to detect if all matches in a round are finished or misarranged.
- Replace refresh button with:
  - Finished Round: `Copy for HT: [COPY_ICON]`
  - Upcoming Round: `Last checked + [RELOAD_ICON] + [COPY_ICON_WITH_TOOLTIP]`
- Implement `react-tooltip` for the Copy functionality.
- Implement formatting for forum copy-paste functionality (as per user sketch).

## Verification

1. Home page: Check if `2/15` (finished/total) is correct, including misarranged.
2. Fixtures tab: Check round header for updated copy/refresh controls.
3. Clipboard: Verify formatted text matches user requirement.
