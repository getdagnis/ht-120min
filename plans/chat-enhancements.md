# Plan: Chat Enhancements

Enhance the tournament chat with own/other message distinguishing, avatars, guest restrictions, and profile modal integration.

## Objective
- Align own messages to the right, others to the left.
- Restrict guests from posting in chat.
- Add avatars (50% size, top-aligned) to messages.
- Open manager profile modal on name click.
- Distinguish non-league managers with a separate style.

## Proposed Changes

### 1. Database Update (`migrations/027_chat_updates.sql`)
- Add `author_ht_id` (BIGINT) to `tournament_chat`.
- Add FK: `tournament_chat.author_ht_id` -> `profiles.hattrick_user_id`.

### 2. TournamentView.tsx
- **`fetchChat`**: Update query to `.select('*, profiles(avatar_json)')`.
- **`handlePostChat`**: Include `author_ht_id` from `localStorage`.
- **`ChatView` Props**: Pass `myHtUserId` and the list of `leagueManagerIds`.

### 3. ChatView.tsx
- **Guest Protection**: Render a "Login to say something..." message if `myHtUserId` is null.
- **Avatar Integration**: Use `Avatar` component with `scale: 0.5`.
- **Layout**:
  - Own messages: `flex-direction: row-reverse`, `align-self: flex-end`.
  - Other messages: `flex-direction: row`, `align-self: flex-start`.
- **Profile Link**: Update manager name link to set `profileId` search param.
- **Classes**: Apply `styles.ownMessage`, `styles.otherMessage`, and `styles.externalManager`.

### 4. TournamentView.module.sass
- Update `.chatMessage` to use flex-row.
- Style `.ownMessage` and `.otherMessage` for proper alignment and background.
- Style `.chatAvatar` container (55px width/height).
- Implement `.externalManager` style (e.g., subtle border or different author color).
- Style `.loginToPost` message.

## Verification
- Login and post a message: Verify it's on the right with an avatar on its left.
- View as guest: Verify input is hidden and "Login to..." is shown.
- Click a manager name: Verify the profile modal opens.
- Message from a non-league manager: Verify the `externalManager` class is applied.
