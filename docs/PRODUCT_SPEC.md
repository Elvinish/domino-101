# Domino 101 — Product Specification

> **Product type:** Responsive real-time multiplayer web application
> **Primary game mode:** Azerbaijani-style Domino 101, 4 players, 2v2
> **Gameplay rules:** See `GAME_RULES.md`. That file is authoritative.

## 1. Product vision

Build a polished, fun, mobile-friendly Domino 101 web app where four friends can open a link, join the same private room, sit at a virtual table, play in real time, chat, and later talk by voice.

The experience should feel like a modern web app, not an old browser-game portal.

Visual direction:

- elegant modern domino table;
- subtle Azerbaijani / Bakı character without kitsch;
- dark green / warm table feel;
- tactile domino tiles;
- responsive layout;
- strong mobile usability;
- smooth but restrained animations;
- clear turn feedback;
- playful reactions and social energy.

## 2. MVP scope

### Included

- 4-player online matches.
- 2v2 teams with opposite seating.
- Guest play; no account required for MVP.
- Create private room.
- Join private room by short code.
- Join by shareable URL.
- Player display name.
- Lobby with four seats.
- Ready state.
- Start match when room has four eligible players.
- Server-authoritative gameplay.
- Complete approved Domino 101 rules.
- Realtime updates.
- Reconnect after temporary network loss.
- Text chat.
- Quick emoji reactions.
- Starter-selection flow between rounds.
- Responsive desktop/tablet/mobile UI.
- Russian and Azerbaijani-ready localization architecture.
- English-ready localization architecture.
- Match-end screen and rematch flow.
- Basic sound effects with mute control.

### Explicitly not required in MVP

- Public matchmaking.
- User accounts.
- Ranking / ELO.
- Leaderboards.
- Tournaments.
- Payments.
- Gambling.
- Production AI opponents for public matchmaking.
- Native iOS or Android app.
- Voice chat.
- Spectators.
- Friend lists.

### Required development/testing bots

The project **must include deterministic test bots** so one human developer can test a full four-player match without waiting for three other people.

Bots are a developer/testing capability first, not a public AI feature.

Required capabilities:

- fill any empty seat with a bot;
- support `1 human + 3 bots`;
- support `2 humans + 2 bots`;
- support `4 bots` for automated simulations;
- bots use the same legal-move API as human players;
- bots must never bypass server validation;
- bots must never inspect hidden opponent hands;
- bot decisions must be reproducible when a deterministic seed is supplied;
- provide a simple development control to add/remove bots from a private room.

Initial bot strategy should be intentionally simple and deterministic:

1. get all legal moves from the game engine;
2. if no legal move exists, pass;
3. otherwise choose one legal move using a deterministic heuristic;
4. never calculate scores or mutate game state independently.

A stronger strategy can be added later, but bot intelligence is not an MVP requirement.

These can be added later without redesigning the game engine.

## 3. Core user flow

### Host

1. Open landing page.
2. Enter display name.
3. Click `Create Table`.
4. Receive room code and shareable link.
5. Share link/code with friends.
6. Wait in lobby.
7. Players occupy seats.
8. All players become ready.
9. Match starts.

### Guest

1. Open shared room URL or enter room code.
2. Enter display name.
3. Join an available seat.
4. Mark ready.
5. Play once all four players are ready.

## 4. Room model

Each room has:

- `roomId`
- human-friendly `roomCode`
- status:
  - `lobby`
  - `playing`
  - `starter-selection`
  - `finished`
- four fixed seats
- team mapping
- players
- connection state
- ready state
- active match
- chat messages
- created/updated timestamps

Room codes should be easy to type and avoid ambiguous characters where practical.

## 5. Seating and teams

Display the four players around the table.

The local player should always be rendered at the bottom for usability, while logical seat identity remains unchanged on the server.

Partners sit opposite one another.

Suggested logical seats:

- `NORTH`
- `EAST`
- `SOUTH`
- `WEST`

Suggested teams:

- Team A: NORTH + SOUTH
- Team B: EAST + WEST

The UI may rotate perspective for each client, but server seat IDs remain stable.

## 6. Game table UX

### Center

- Domino chain.
- Left and right open ends visually clear.
- Automatic layout that bends/wraps as the chain grows.
- No overlap with player areas.
- Smooth placement animation.

### Local hand

- Large touch-friendly tiles.
- Legal tiles visually identifiable on the player's turn.
- Illegal tiles subdued.
- Selecting a tile that can fit both ends must allow left/right choice.
- On mobile, target size must be comfortable for thumbs.

### Opponent hands

- Show tile backs/count only.
- Never expose hidden tile values.

### Turn indication

Clearly show:

- whose turn it is;
- local turn state;
- pass state;
- connection state;
- current scores;
- pending opening points where appropriate;
- whether each team has opened its score;
- SEKA Bank.

## 7. Scoreboard

Show both teams with:

- official score;
- opened/closed status;
- pending opening points if closed;
- SEKA Bank separately.

The interface must not call pending opening points "SEKA Bank".

## 8. Round result UI

At the end of each round, show a concise result panel:

- winning team, or SEKA;
- reason:
  - player emptied hand;
  - bağlanma;
- losing remaining points;
- round value;
- SEKA Bank change;
- pending points gained/burned;
- score opening event if applicable;
- updated match scores.

Keep it understandable without forcing users to read a long log.

## 9. Starter-selection UX

After a non-SEKA round:

- the winning team receives starter rights;
- both winning partners are visibly eligible;
- they can coordinate via chat;
- an eligible player can choose to start the next round;
- server locks the first valid selection;
- other players see who will start.

Do not automatically assign the starter to the player who emptied their hand.

## 10. Text chat

Room-scoped realtime chat.

Requirements:

- visible during lobby and match;
- mobile-friendly collapsible panel;
- player name + timestamp;
- bounded message length;
- server validation/sanitization;
- rate limiting;
- no HTML rendering from user content;
- reconnect should restore a limited recent message history.

Quick reactions:

- 😂
- 👏
- 🔥
- 🤦
- 😡

Reactions should not interrupt gameplay.

## 11. Reconnect

A player who refreshes the page or temporarily disconnects should be able to reclaim their seat.

Use an opaque reconnect/session token stored client-side.

Requirements:

- reconnect token is not a user password;
- token maps to room/player identity;
- other players see disconnected/reconnecting state;
- disconnected player's hidden hand remains server-side;
- reconnection returns only that player's authorized private state.

Do not expose another player's hand during reconnect.

## 12. Disconnect behavior

MVP should not immediately terminate a match when someone disconnects.

Recommended behavior:

- mark player disconnected;
- pause turn progression if it is their turn;
- allow reconnection;
- expose host/room controls for abandoning/rematching if a player does not return.

Do not invent an automatic timeout-based forfeit until product policy is explicitly approved.

## 13. Rematch

After match end:

- show winner;
- show final score;
- allow all four players to request rematch;
- reuse room and seats;
- create a fresh match state;
- reset official scores, pending opening points, opening flags and SEKA Bank.

## 14. Localization

Architecture must support:

- Azerbaijani (`az`)
- Russian (`ru`)
- English (`en`)

Do not hardcode user-facing text inside random components.

Use translation keys.

MVP may initially ship with Russian plus a translation-ready structure, but code must not make future languages expensive.

## 15. Visual style

Avoid:

- casino visual language;
- fake money/chips;
- cluttered old-game-site UI;
- excessive gradients;
- childish cartoon styling;
- folklore-heavy decoration.

Prefer:

- premium but friendly table;
- dark neutral shell;
- green felt/table surface;
- ivory/stone-like domino tiles;
- crisp typography;
- subtle Bakı/Azerbaijan identity;
- compact player cards;
- polished microinteractions.

## 16. Sounds

Optional lightweight sounds:

- tile placed;
- turn notification;
- pass;
- round won;
- SEKA;
- match victory.

Always provide mute toggle.

Do not autoplay voice/audio in a way that violates browser policies.

## 17. Voice chat — Phase 2

Voice chat is intentionally deferred until core multiplayer is stable.

Preferred direction:

- WebRTC-based room voice;
- push-to-talk and/or mute;
- per-player mute controls;
- clear microphone permission UX;
- connection indicators.

For four-player rooms, architecture should allow either:

- peer-to-peer mesh for a simple early version, or
- an SFU provider/service later for better reliability and scaling.

Do not couple voice transport to the Domino game engine.

## 22. Development bot controls

For local development and private test deployments, the lobby should expose developer-friendly controls such as:

- `Add Bot`
- `Remove Bot`
- `Fill Empty Seats With Bots`
- optional `Run Bot Match`

These controls may be hidden behind a development/test feature flag in production.

Bot players must look like normal seats in the UI but be clearly labeled, for example:

- `Bot 1`
- `Bot 2`
- `Bot 3`

Bots should have a small configurable action delay so gameplay remains observable during manual testing.

Recommended default delay:

- 300–800 ms in normal manual testing;
- 0 ms in automated simulations.

Do not couple bot behavior to React components.

## 18. Security / fairness requirements

- Game server owns shuffle/deal.
- Never send all hands to every client.
- Each client receives only:
  - its own hand;
  - public board state;
  - opponents' tile counts;
  - public scores/state.
- Validate every gameplay command server-side.
- Reject replayed/stale commands.
- Rate-limit room creation, joining and chat.
- Validate names and room codes.
- Sanitize text.
- Use secure random generation where appropriate.
- Do not log secret reconnect tokens or hidden hands in production logs.

## 19. Accessibility

- Sufficient contrast.
- Do not rely on color alone for legal/illegal state.
- Keyboard support for major desktop interactions.
- ARIA labels for interactive tiles/buttons.
- Respect reduced-motion preference where practical.

## 20. Performance goals

For a four-player room:

- gameplay events should feel immediate;
- avoid full room-state broadcasts when smaller typed events/snapshots are sufficient;
- animation must not block authoritative state;
- support reconnect snapshot efficiently.

MVP does not need premature global-scale optimization.

## 21. Future features

Design extension points for, but do not implement yet:

- public matchmaking;
- profiles/accounts;
- rankings;
- statistics/history;
- friend invites;
- spectators;
- tournaments;
- bots;
- native mobile app;
- voice chat;
- moderation;
- multiple Domino variants.
