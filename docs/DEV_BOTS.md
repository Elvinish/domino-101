# Host-managed room bots

The host can play through the normal room flow with server-managed bots. This is an addition to the completed Phases 0–9; game rules, scoring, reconnect credentials, chat and voice remain on their existing paths.

## Using bots

1. Create a private room with your display name.
2. Click **Add bot** on an empty seat, or **Fill empty seats with bots**.
3. Use **Remove bot** to free a bot seat while still in the lobby.
4. Start when exactly four seats are occupied and every human is connected. One human plus three bots works.
5. Play your own tiles normally. Bots act after a short delay. The human host still clicks **Start next round** at the end of a round.

Controls and bot labels are translated into English, Russian and Azerbaijani, with desktop, tablet and phone layouts. Guests cannot see or invoke bot management. Disconnected/pending clients cannot submit it. Controls disappear during play. A bot's `connected: false` means it has no socket; its seat shows **Bot** and **Ready**, and it does not pause play.

## Authority and scheduling

`room:bots` uses a strict shared Zod contract with a room ID, expected revision and an `add`/`remove` seat action or `fill`. Identity, team and other client-supplied fields are rejected. The server generates bot UUIDs and names, validates the empty seat, and derives teams from the existing seat mapping. It checks current socket ownership, room membership, host identity, lobby phase and revision inside the existing room queue. A successful management operation commits once and increments the revision once. Occupied seats and more than four members are rejected.

`apps/server/src/bots/scheduler.ts` uses the existing `getBotView` and `chooseCommand(..., 'deterministic-first', 0)` APIs. A bot sees its own hand and public information only. There is no additional legality or scoring implementation. Normal production deck shuffling is unchanged.

One timer per room waits **650 ms** before each action. Its ticket contains room ID, match ID, player ID and revision, never a hand. The callback enters the existing per-room serial queue, checks ticket ownership, room availability, current match/revision, human readiness and current bot actor, then recomputes the legal decision. Human and bot commands use the same `RoomService.applyGame` engine dispatch, revision, idempotency, persistence and publication path.

A new state cancels obsolete work. A callback can fire only once, and stale or already queued callbacks cannot apply a superseded command. Each next bot action gets a new delay. Rejected submissions do not create automatic retry loops. Persistence failures use the existing locked-room recovery path. Shutdown, human disconnect and room removal cancel timers; match completion has no scheduled turn.

Bots handle first-round opening, tile/end selection, passes, eligible starter selection, later rounds, SEKA and completion through engine commands. During starter selection, the lowest-numbered eligible bot schedules its deterministic choice; an eligible human may act before that timer, invalidating it. Bots never advance the host's round-result screen automatically.

## Membership, persistence and privacy

Bots have no Socket.IO connection, reconnect token or token hash. They receive no session, private snapshot, chat or voice network events. Human snapshots retain the existing explicit projection of only that human's hand. The public membership addition is `kind: 'human' | 'bot'`; bot timing and internal command history are not exposed. No new payload/state logging is added.

Migration `apps/server/drizzle/0001_dev_bots.sql` adds the required membership kind to `room_players`, defaults existing rows to `human`, checks the allowed kinds and disallows bot token hashes. Existing serialized version-1 memberships without a kind also default to human. The codec rejects bot credentials and bot hosts. Bot identities, seat positions and normal bounded command histories persist in the existing transaction together with authoritative match state.

In PostgreSQL mode, restart restores the same bot identities and match state. Humans restore as disconnected, so bot play waits for all humans to reclaim their reserved seats, then starts a fresh timer. Timer tickets are deliberately ephemeral. Human reconnect tokens and stale-socket protections are unchanged. A departing lobby host transfers ownership only to another human; a lobby left with only bots is removed. Bots do not extend an offline room's existing expiry.

Apply the checked-in migrations with `pnpm db:migrate`, or after a production build with `pnpm --filter @domino/server db:migrate:production`. Startup also uses the existing migration path. Ship `apps/server/drizzle/` with the compiled server. Upgrade the web and server together because strict public room snapshots now require `kind`.

## Important files

| File                                                              | Responsibility                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `packages/protocol/src/multiplayer.ts`                            | Strict bot request and public membership contracts               |
| `apps/server/src/bots/scheduler.ts`                               | Deterministic decisions, delay and stale-ticket cancellation     |
| `apps/server/src/rooms/service.ts`                                | Host authorization, membership and shared game command execution |
| `apps/server/src/persistence/` and `apps/server/src/db/schema.ts` | Durable membership kind and validation                           |
| `apps/server/drizzle/0001_dev_bots.sql`                           | Additive migration with bot credential constraints               |
| `apps/web/src/multiplayer/client.ts`                              | Typed lobby requests and client action guards                    |
| `apps/web/src/components/Room.tsx`, `Seats.tsx`, `Feedback.tsx`   | Host controls, bot seat state and accessible status              |
| `apps/web/src/i18n/{en,ru,az}.ts`                                 | Translated controls and labels                                   |
| `e2e/bots.spec.ts`                                                | Real one-human/three-bot browser round                           |

## Verification

Tests cover add/remove/fill, capacity, malformed identities/teams, non-host and cross-room rejection, stale sockets/revisions, no bot credentials, host transfer, normal human disconnection, duplicate callbacks, queue races, failed writes and restart recovery. A bounded deterministic server test completes a match and asserts passes, ambiguous ends, starter selection and SEKA. Socket.IO checks use real clients and audit outbound snapshots. PostgreSQL tests use a dedicated disposable database and actual stopped/restarted server instances. React tests cover host/non-host controls, socketless readiness, pending/disconnected/replaced state and all three languages.

Final verification on 2026-10-03 used Node 24.21.0, pnpm 10.34.5, native PostgreSQL 18.6 and Playwright 1.63.0 with Chromium 153.0.8010.12. All final checks passed with no skipped tests in the full Vitest run.

| Check                                        | Exact result                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format` / `pnpm format:check`          | Prettier applied; final formatting check passed                                                                                               |
| `pnpm lint`                                  | Passed with zero warnings                                                                                                                     |
| `pnpm typecheck`                             | All packages, apps, test sources, tools and E2E types passed                                                                                  |
| `TEST_DATABASE_URL=… pnpm test`              | **532 tests passed / 44 files**, including PostgreSQL; 56.15 seconds                                                                          |
| `pnpm test:socket`                           | **55 tests passed / 6 files**                                                                                                                 |
| `TEST_DATABASE_URL=… pnpm test:postgres`     | **17 tests passed / 1 file**                                                                                                                  |
| `pnpm build`                                 | Shared packages, compiled server and production web build passed; rerun after browser tests to restore default web configuration              |
| Compiled `apps/server/dist/db/migrate.js`    | Clean database and legacy-schema upgrade both passed; repeat invocation passed on each; both recorded exactly two migrations                  |
| Legacy migration check                       | Existing human identity, token hash and revision retained, with kind defaulted to `human`                                                     |
| `pnpm db:generate` after migration           | No schema changes; SQL metadata matches the schema                                                                                            |
| `DOMINO_E2E_SYNTHETIC_AUDIO=1 pnpm test:e2e` | **15 passed in 2.2 minutes**: 5 desktop, 5 tablet, 5 phone                                                                                    |
| New bot browser scenario                     | **3/3 passed**: one human adds/removes/fills seats, starts, plays real moves and completes a round against three automatically scheduled bots |

Socket.IO and PostgreSQL counts are subsets of the full Vitest total. The bot-related additions account for 36 new tests, bringing the previous 496 to 532. The final queue race test was added after an initial full run; the complete suite and type/lint checks were rerun successfully.

The browser server is real, uses the production build and has no mocked bot actions or timer acceleration. Desktop/tablet/phone bot lobby screenshots were visually inspected, and automated checks verified no horizontal overflow in the lobby and completed-round view. The existing multiplayer, localization, chat, reconnect and voice E2E scenarios also passed. The voice regression uses the existing explicit synthetic microphone-capture fallback: native WebRTC transport still runs, but physical microphone capture is not established by this run.

The PostgreSQL tests used dedicated local test databases. Additional disposable databases verified fresh compiled migrations and upgrading the original Phase 8 schema with an existing human membership. No production database was accessed. Logs for this run are under `/private/tmp/domino-bots-*.log`; browser images are under `test-results/` and are not source artifacts.

## Limitations

- This is a simple deterministic opponent for local/staging play, not a stronger AI or difficulty system. It uses no hidden opponent hands.
- Bots can only be added or removed in the lobby. They do not replace disconnected humans during an active match. Every seated human must be connected for play to continue.
- The human host advances rounds manually. Bots neither chat nor join voice.
- Memory mode loses rooms on server restart. PostgreSQL mode retains them until the existing room-expiry policy removes them.
- The existing single-application-instance deployment requirement remains. No distributed bot worker or cross-instance room authority was added.
- Browser phone/tablet coverage uses Chromium device emulation; physical iOS/Android devices are not validated here. Full-match browser completion is optional and not required for the bot scenario; the server test verifies full-match completion.
- No domain, hosting, TURN, deployment configuration or infrastructure was provisioned or changed.
