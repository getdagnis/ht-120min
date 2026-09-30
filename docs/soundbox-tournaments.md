# Soundbox tournaments

## Product purpose

Official/public soundbox tournaments are organizer training environments.

Their purpose is to let a new tournament organizer learn the real HT-120min admin workflow safely: managing a roster, configuring a tournament, generating a schedule, handling fixtures, entering or refreshing results, publishing updates, and moving through the normal tournament lifecycle.

They are not primarily private playgrounds for the site owner or a place to experiment with arbitrary product ideas. The measure of success is whether a new organizer can learn the same admin work they will later perform on a real tournament.

## Fidelity to real tournaments

A soundbox should behave as close to a real tournament as possible. The expected baseline is a 1:1 training experience across:

- tournament settings and restrictions;
- team registration and roster management;
- schedule generation and round management;
- fixtures, warnings, results, standings, and history;
- tournament news, activity, chat, and organizer administration;
- the normal season and lifecycle transitions.

The soundbox may remove tournament-specific limitations that would prevent learning. Where another tournament type exposes a legitimate option, the soundbox should generally expose it too. These are training affordances, not a separate competition model.

## Time travel is part of the training model

A real season takes too long to complete for an organizer to learn the full lifecycle by waiting for real dates. Soundboxes therefore need an explicit time-travel or round-simulation capability so an organizer can move through planned rounds, deadlines, results, reports, and later-season states on demand.

Time travel should simulate the passage of tournament time without requiring real managers to wait a full season and without changing the underlying product rules being taught.

## Keep concepts separate

The codebase has historically used “sandbox” for both public test tournaments and detached copies created by an administrator. These concepts must not be conflated:

- a public soundbox is an organizer education product and should be optimized for fidelity to real tournaments;
- a detached copy may be an implementation or setup mechanism, but its acceptance criteria come from the soundbox training goal, not from private site-owner experimentation;
- real tournaments, their managers, credentials, participation, and history must remain isolated from any soundbox copy.

When product or implementation decisions are unclear, prefer the question: “Will this help a new organizer learn to run the real tournament?”
