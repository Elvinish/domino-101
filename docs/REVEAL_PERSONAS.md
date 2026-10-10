# Round reveal and persistent player names

## Server-authorized reveal

`projectPublicGame` emits `revealedHands` only for `round-ended` and
`match-finished`. The four arrays contain copies of the engine's actual remaining
hands, indexed by absolute seat. Empty hands remain empty. No new endpoint or
client reveal command exists. Normal commit-before-broadcast ordering applies.
Playing and starter-selection snapshots omit the field entirely, including on
reconnect. Advancing the round removes the previous reveal from the snapshot.

The strict Zod protocol rejects a reveal in an active phase or with lengths that
disagree with public hand counts. The field is optional for active snapshots and
backward-compatible parsing; the server always supplies it for ended rounds. The client also
checks the ended phase before rendering it. Internal engine state, credentials
and future hands are never added to the public projection.

Desktop/tablet replace concealed tiles in the existing hand layers with ivory
faces. On phones, which already hide the decorative hands, the remaining tiles
appear beside their seat information. Seat-relative placement, own playable hand,
snake layout, movement preferences and gameplay controls are unchanged.

## Player personas

`packages/protocol/src/personas.ts` contains **340 unique names**, mostly familiar
across CIS countries and neighbouring cultures. The server filters out occupied
display names (case-insensitive, ignoring surrounding whitespace), then uses
Node's `crypto.randomInt` to select from the available names. Each addition in a
fill operation sees the preceding additions. The pool is much larger than the
four-seat room limit; a full-pool fallback exists for callers outside this limit.

A persona uses the existing immutable membership `playerId`, `displayName` and
`kind` (`human`/`bot`, internal equivalent of playerType). Names are chosen only
when creating a membership and persisted through the existing room serializer
and PostgreSQL `room_players.display_name`; no schema migration is required.
Reconnect resolves the existing membership and never picks a name. Restore reads
the stored name. Legacy generated `Domino 1`–`Domino 4` names are upgraded once on
restore and saved before publication; natural names and human names are retained.

Presentation uses displayName with a small accessible AI badge. Authored gender
metadata in the shared catalog selects matching hands and a connected upper
torso; see [visual personas](BOT_VISUAL_PERSONAS.md). Add/remove/fill
controls use neutral player wording in RU/EN/AZ. Internal kind still controls
authorization and scheduling; no strategy or bot decision code changed.

Avatars remain separate from game snapshots: the existing playerId-to-avatar
adapter and local editable avatar continue working, with initials as fallback.
This preserves the future account/profile integration point without inventing an
account system or sending avatar uploads through game commands.

## Verification

- Name pool validation, case-insensitive uniqueness, stable membership names
  across reconnect and two restores, one-time legacy name upgrade.
- Full-match projections verify no foreign tile values in active snapshots and
  exact seat-indexed reveals at round/match end; malformed early reveal is rejected.
- Real Socket.IO event audit covers private active snapshots and completed reveals;
  reconnect explicitly checks that foreign hands remain absent.
- Frontend checks exact revealed faces, empty hands and clearing at the next round.
- Playwright covers desktop/tablet/phone, completed hand rendering, unique names,
  reload persistence and existing controls/chain layout.
- PostgreSQL tests additionally cover round-ended recovery and persisted names;
  run with a dedicated `TEST_DATABASE_URL` ending in `_test`.

Verified on 2026-10-08: **581 Vitest tests passed**, including real Socket.IO and
in-memory persistence/restart integration; **18 PostgreSQL tests skipped** because
no dedicated test database is configured. **9 Playwright tests passed** across
desktop, tablet and phone emulation. Revealed hands were visually inspected on all
three layouts. Formatting, lint, full workspace typecheck and production build
passed. Real PostgreSQL execution remains unverified for this change.
