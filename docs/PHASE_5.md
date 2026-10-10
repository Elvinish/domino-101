# Phase 5 — secure reconnect and seat restoration

## Identity and server ownership

`playerId` is a stable, server-generated room membership identity. A Socket.IO
`socket.id` identifies only its current transport. The existing per-room queue now
serializes reconnect, disconnect and explicit leave with gameplay. No game rules,
engine state transitions, score calculations or authoritative projections changed.

A successful reconnect binds a live socket to the same player, seat, team, hand,
match and command-history map. Gameplay still requires the current socket binding;
client-supplied identities remain forbidden in gameplay commands. Token possession
authenticates only the named room/player membership, not any other seat.

Before a replacement receives projections, the old socket mapping is removed. The
old socket receives a private `room:replaced` notice and no further room/game updates.
The browser stops reconnecting and clears its private game view, avoiding two tabs
automatically taking the seat back from each other. A raw stale socket that remains
open is rejected by normal authorization, including before an idempotent replay.
A late disconnect from it checks the current binding and cannot disconnect its
replacement. Concurrent valid reconnects serialize; the last accepted one owns the seat.

## Token lifecycle and security

Human membership creation uses `crypto.randomBytes(32)` to generate a 256-bit bearer
secret, encoded as 43 base64url characters. The server retains only its SHA-256 hash.
A submitted token is hashed and compared with `timingSafeEqual` using equal-length
buffers. Missing player hashes use a fixed-size dummy comparison. Unknown rooms,
missing memberships, wrong tokens and revoked memberships return `INVALID_SESSION`
without revealing which credential component matched. Malformed shapes return the
existing sanitized `INVALID_PAYLOAD` code.

The raw token is delivered once, only to the newly seated socket. It is not retained
in the room object, reissued in reconnect responses, rotated on refresh, or put in a
URL. Keeping the credential stable avoids losing recovery after an interrupted
rotation and permits deliberate same-browser multi-tab replacement. The token is
valid until explicit online leave, room expiry, or server shutdown/restart. It is
not account authentication. Anyone possessing it can take that seat; serve the app
with HTTPS/WSS outside localhost and protect the origin from script injection.

The trusted RoomService create/join API accepts a server-only `bot` kind. Such a
membership has no token hash and emits no session. This option is absent from strict
network schemas; a guest cannot request it. Existing bot strategies remain unchanged
and have no session/token dependency. Browser and Socket.IO QA clients using the guest
entry protocol intentionally represent humans, even when a bot selects their moves.

## Typed events

All new payloads live in `packages/protocol/src/multiplayer.ts` as strict Zod schemas
and shared Socket.IO interfaces.

| Direction                        | Event            | Payload / behavior                                                                |
| -------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| Private server → owner           | `room:session`   | `{ roomId, playerId, reconnectToken }`, only on initial human membership creation |
| Client → server                  | `room:reconnect` | Same three fields; validate and bind to existing membership                       |
| Private server → replaced socket | `room:replaced`  | `{}`, no credential or other session information                                  |
| Client → server                  | `room:leave`     | `{ roomId }`; authorize current owner, revoke token, leave seat                   |

Reconnect sends `room:joined` and fresh room/game projections to the new owner, with
normal acknowledgement/result semantics. Other connected players receive only safe
room and their own game projections. No token/hash is allowed in shared schemas,
command results or errors. Logging remains fixed event/code information only;
validation issues, raw exceptions, credentials and private game state are not logged.

## Revisions, idempotency and disconnects

Revision never resets on reconnect. Gameplay state, score and hand remain intact.
A disconnect increments the room revision once for the public connected-state change;
a reconnect from disconnected increments once for the corresponding return. A
connected-to-connected replacement changes no public state and preserves the exact
revision. Command results can replay an older cached revision without rolling the
client snapshot backward. The existing 128-command FIFO history stays on the same
player across socket replacements; conflicts and stale revisions are still enforced.

Ordinary disconnect reserves the seat in lobby, active game and completed match.
The lobby host is retained and cannot start until all four are connected. Active
games pause and keep private hands intact. New guests cannot steal reserved seats.
When every player is offline, the room survives for **30 minutes**. Returning or
joining a connected seat cancels expiry. Expiry checks timer generation and current
ownership inside the room queue. Timers are cleared on shutdown, and the existing
1,000-room bound remains. An individual offline seat does not expire while another
player keeps the room alive; removal/forfeit policies are deliberately deferred.

Explicit online leave revokes the token immediately. In a lobby it releases the
seat, transfers host to the lowest remaining seat if needed, and deletes an empty
room. In an active/completed match it keeps the seat/hand reserved but non-recoverable;
no forfeit or replacement player is invented. The other players need a fresh room
if someone deliberately leaves an active match. All-offline room expiry still applies.

## Browser storage and refresh

`apps/web/src/multiplayer/session.ts` stores exactly the three-field private session
in per-tab `sessionStorage` under `domino101.session.<roomId>`. No hand, score, socket ID or full
snapshot is stored. Per-room keys avoid using one room's credential in another.
Storage reads are validated; denied/corrupt storage fails safely without logging.
If a write is denied, a visible notice explains that in-tab recovery works but a
refresh may lose the seat. The in-memory session is outside React's public client
snapshot and never visibly rendered or included in invite links.

The route tells the client which room to restore. After transport connection, a
matching saved session automatically sends `room:reconnect`, shows “Restoring seat”,
and receives a fresh authoritative projection. There is no manual display-name
reentry when recovery succeeds. A temporary transport drop clears the private game
view, cancels pending callbacks, retains the credential and attempts reconnection up
to five times (500 ms initial delay, at most 3 seconds between attempts). A manual
Retry connection button remains available after network failures. Pending gameplay
is never automatically replayed; the fresh snapshot resolves uncertain outcomes.

Invalid credentials/expired rooms clear the unusable session and return to normal
entry with a generic useful message. Transient server/network errors preserve the
session. A timeout disconnects rather than sending buffered stale moves; manual retry
restores the authoritative table. Ordinary disposal/refresh does not clear storage.
A replaced tab offers Dismiss old table, which preserves the active tab’s saved
session and cannot revoke its membership. Explicit leave from the active tab clears the local credential and requests server revocation while
connected. Offline leave can only clear browser storage; the inaccessible server
retains the membership until its normal expiry or restart.

## Tests and privacy

- Protocol: strict private session/request shape, token bounds/characters, rejection
  of extra identity/secret fields in leave/replacement DTOs.
- Room service: hash-only storage, token-free trusted bot identity, simultaneous
  replacements, stale queued commands, old disconnect races, all-offline expiry and
  cancellation, shutdown invalidation.
- Real Socket.IO: private entropy-bearing session issuance, token isolation and logs,
  wrong room/player/token and cross-room misuse, malformed credentials, exact identity,
  hand and game restoration, continued gameplay, lobby retention, all-offline recovery,
  newest socket ownership, idempotency/revision/game legality and explicit revocation.
- Frontend: minimal storage, matching-route restore, transient versus permanent
  failures, reconnect without gameplay replay, replacement-loop prevention, explicit
  leave, denied/corrupt storage and foreign-session rejection.
- Playwright: actual production web/server, four isolated browser contexts, hard
  refresh of the active player, exact restored player/seat/hand/match, real continued
  play, same-context second-tab replacement and old-tab private-view removal. Runs
  at desktop, tablet and phone sizes. Audits captured wire events and visible content
  for token isolation; checks restored projection against opponents' hidden hands.

Existing full-match browser and Socket.IO audits include the new private events
rather than skipping them. The old lobby-disconnect removal test now exercises
explicit leave, while dedicated new tests enforce retained seats on ordinary
transport disconnect. Game-engine and bot tests remain unchanged.

## Verification results

Using Node.js 24.21.0, pnpm 10.34.5, Vitest 4.1.11 and Playwright 1.63.0:

| Check                                                            | Result                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Frozen-lockfile offline installation                             | Passed; lockfile current                                                                         |
| Prettier                                                         | Passed across the repository                                                                     |
| ESLint                                                           | Passed with zero warnings                                                                        |
| Full TypeScript typecheck                                        | Passed, including E2E configuration                                                              |
| Full Vitest                                                      | **358 passed in 25 files**, zero failures (53.52 seconds)                                        |
| Dedicated Socket.IO suite                                        | **41 passed in 3 files**, zero failures (706 milliseconds)                                       |
| Production build                                                 | Passed for all packages, server and web                                                          |
| Completed Playwright run before the final replaced-tab UX polish | **6 passed**, zero failures: desktop, tablet and phone existing flow plus refresh/reconnect flow |

The final non-escalated Playwright rerun after the replaced-tab “Dismiss old table”
polish could not start its local web servers in the sandbox (`Server failed to
listen. Check host and port availability.`). An escalated rerun was rejected by
the environment approval quota. No browser result is claimed for that final
post-polish rerun. The changed behavior is covered by frontend Vitest tests and
the earlier real-browser run covered hard refresh, exact seat/hand restoration,
continued gameplay, multi-tab replacement, and desktop/tablet/phone layouts.

The successful browser run used the actual production web build and Fastify/
Socket.IO server, four isolated contexts, no socket mocks, and wire/UI privacy
audits. The only browser-run warning was non-failing `NO_COLOR` versus
`FORCE_COLOR` output from the test web-server processes.

## Limitations and next phase

This is a single-process, in-memory session system. Server restart loses rooms and
hashes; saved browser sessions then fail safely. There is no PostgreSQL, cross-server
reconnect, Redis, account authentication, chat, reactions, voice or deployment work.
No hosting/domain/TURN was provisioned. A token is a bearer credential accessible to
same-origin JavaScript and browser users; XSS protection and HTTPS are production
requirements. Offline explicit leave cannot revoke a credential on an unreachable
server. A deliberately abandoned active seat has no replacement/forfeit mechanic.

Physical devices, Safari/Firefox and remote production networks are not verified by
Chromium viewport emulation. Stop after Phase 5; Phase 6 requires explicit instruction.
