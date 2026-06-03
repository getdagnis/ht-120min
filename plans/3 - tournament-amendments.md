# 3 - Tournament Refinement Amendments (Revised)

## 1. Registration Types & Naming

- **Rename types**:
  - `validated` -> **"Hattrick Validated (CHPP)"**
  - `manual` -> **"Organizer-Managed"**
- Update labels and descriptions in `CreateTournament.tsx` and `TournamentView.tsx`.
- Update error messages in `api/auth/callback.ts`.

## 2. Team Name & Interaction

- All team names in admin/forms must be `readOnly`.
- CSS: Use `pointer-events: none` on non-editable names (except for text selection).

## 3. Creation & Organizer Identity

- **Organizer Role**: In "Organizer-Managed" flow, linking Hattrick identifies the user as the "Organizer" (Name + Avatar).
- **Optional Join**: After linking, the organizer is NOT automatically added as a participating team. They must explicitly add their own team if they want to play.
- **Return to Creation**: OAuth callback will redirect back to the `teams` step of creation.
- **Finalize Button**: Add "Finalize and Create Season 1" to the creation flow.

## 4. Invitation Templates

- Provide **Hattrick Invitation Templates**: A text box with a pre-formatted message including the tournament link for organizers to copy-paste into Hattrick messages.

## 5. Participation Rules

- **One Tournament Rule**: A team can only be active in ONE tournament at a time.
- Throw a strict alert if trying to join/create a new one while active in another.
- **Super-Admin Bypass**: The `issuperadmin="you bet"` cookie allows bypassing this rule.

## 6. Standings & UI

- **Registration Status Box**: Styled like the "120min" mark, placed below it.
- **Join Button**: Moved inside the registration status box.
- **Open Status Message**: "This tournament is still open for registration, you can invite someone to join".
- **Image Placeholder**: 260px by 210px placeholder top right above the standings table.

## 7. Logic Constraints

- **ID Input**: Sync all HT Team ID fields to `type="text"` with `\D/g` regex.
- **Recurring schedule**: Limit to tournaments with 2-4 teams.
- **Bug Fix**: Allow self-registration in "Organizer-Managed" tournaments.

## 8. Tournament Creation Journeys

┌───────────────┬──────────────────────────────────────────────┬──────────────────────────────────────────────┐
│ Feature       │ Hattrick Validated (CHPP)                    │ Organizer-Managed                            │
├───────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────────┤
│ Primary Goal  │ Automated, self-service participation.       │ Organizer-driven coordination (freedom to    │
│               │                                              │ add).                                        │
│ Initial Link  │ Button: "Link with Hattrick" (as player #1). │ Button: "Link Organizer Profile" (as admin). │
│ Team          │ Redirects to OAuthTeamSelect to choose       │ Redirects to OAuthTeamSelect (optionally     │
│ Selection     │ participating team.                          │ choose own team).                            │
│ Return Step   │ Shows Validated Team name/ID.                │ Shows Organizer Name + Avatar.               │
│ Adding Others │ DISABLED. Participants must join personally  │ ENABLED. Organizer adds teams by ID (via     │
│               │ via public link.                             │ "Get data").                                 │
│ Invite        │ DISABLED. (Handled via general public link). │ ENABLED. Specialized message for organizer   │
│ Template      │                                              │ to copy-paste.                               │
│ Finalization  │ Requires at least 1 validated team (the      │ Requires at least 1 linked profile (the      │
│               │ creator's).                                  │ organizer's).                                │
└───────────────┴──────────────────────────────────────────────┴──────────────────────────────────────────────┘

Key Fixes Included:

- Identity Recovery: Restoring the full OAuth-to-Team-Select flow for creators so we capture real names and teams,
  not placeholders.
- Flow Integrity: Ensuring "Validated" tournaments stay pure (no manual adding), while "Organizer-Managed"
  provides the necessary tools (fetching team data by ID).
- Visual Polish: Reverting to the Trophy icon and ensuring all team ID fields are consistent (text + regex).
- Participation Guard: Enforcing the one-active-tournament rule (with your Super-Admin bypass).

Does this side-by-side breakdown correctly capture your vision for the two flows? If so, I'll proceed with the
implementation.[Function Call: exit_plan_mode]
