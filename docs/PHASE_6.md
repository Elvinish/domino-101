# Phase 6 — room chat and reactions

Phase 6 adds room-scoped text chat and six predefined reactions without changing
game state, scoring, reconnect credentials, persistence boundaries, or privacy
projections. Chat uses the existing Socket.IO connection for delivery; it does
not carry audio or media.

## Protocol and server behavior

`packages/protocol/src/multiplayer.ts` defines strict `chat:send`,
`chat:history`, `chat:message`, `reaction:send` and `reaction:received` DTOs.
Clients send only `{ roomId, commandId, text }` or `{ roomId, commandId,
reaction }`. Player IDs, seats and display names are rejected as extra fields.
The server resolves the current socket binding to the room member and ignores all
client identity claims. Stale/replaced sockets and cross-room requests return
`NOT_ROOM_MEMBER`.

Messages are trimmed, reject empty text, and are limited to 500 characters.
Each player may send five messages per ten seconds. A room keeps only the newest
50 messages. Command IDs are idempotent per room/player with bounded history;
reusing an ID with different text or reaction returns
`DUPLICATE_COMMAND_CONFLICT`. Chat runs through the existing per-room serial
queue, so reconnect, disconnect, leave and chat authority cannot race.
History is sent privately after create, join and reconnect. Live messages and
reactions go only to currently seated socket bindings. Room removal clears chat
history, idempotency and rate-limit state. No chat payload, reconnect token,
socket ID, private hand or raw validation error is logged.

## Browser behavior

`MultiplayerClient` validates every chat/history/reaction event, keeps bounded
client state, clears it on disconnect or replacement, and exposes explicit
`sendChat`, `sendReaction` and `markChatRead` methods. Chat has its own pending
request state so gameplay submissions remain independent. The responsive
`ChatPanel` is available in the lobby and during a match, collapses to a compact
bar, uses plain React text rendering, supports Enter to send and Shift+Enter for
a new line, and keeps reaction controls touch-sized on phone layouts.

## Tests and verification

- Protocol tests cover strict envelopes, identity injection, message bounds,
  history bounds and reaction allow-listing.
- Chat service tests cover trimming, plain-text preservation, 50-message history,
  empty/oversize/rate-limit errors, idempotency and stale sockets.
- Browser client tests cover schema validation, unread state, social requests and
  disconnect cleanup.
- Socket.IO tests cover room isolation, server-authored sender identity, stale
  replacement rejection, history delivery, reaction delivery and absence of
  reconnect credentials from chat messages.

The repository's localhost Socket.IO and Playwright suites require permission to
bind loopback ports. In this environment the escalated verification request was
rejected by the approval quota (`listen EPERM` in the sandbox), so those real
network suites remain unverified for this Phase 6 run. Static formatting, lint,
typecheck, package builds, protocol/chat unit tests and existing browser/client
tests run without that permission. The non-network Vitest run completed with
**324 tests passed in 24 files**. The full Socket.IO and Playwright commands were
attempted but could not bind localhost; no pass count is claimed for them.

## Limitations

Chat remains in-memory and single-process, like rooms and reconnect sessions.
Restart or room expiry removes history. This phase does not add accounts,
moderation, persistence, file/media messages, voice, TURN, hosting or domain
configuration. Production still requires HTTPS/WSS, a strict browser origin and
the existing XSS protections around same-origin JavaScript.
