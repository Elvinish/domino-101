# Domino 101 — Game Rules

> **Status:** Approved rules for this project.
> **Priority:** This document is the single source of truth for gameplay.
> The implementation must not silently replace these rules with another online or regional Domino 101 ruleset.

## 1. Match format

- Exactly 4 players.
- Two teams of two players:
  - Team A: players seated opposite each other.
  - Team B: players seated opposite each other.
- Standard double-six domino set: 28 tiles (`0:0` through `6:6`).
- Every player receives exactly 7 tiles.
- There is no boneyard / draw pile.

## 2. Goal

- The match is won immediately when a team's total score becomes **101 or more**.
- Exact 101 is not required.
- Example: `98 + 7 = 105` → match won.

## 3. First round starter

The first round of the match is opened by the player holding the lowest required double in this order:

1. `1:1`
2. `2:2`
3. `3:3`
4. `4:4`
5. `5:5`
6. `6:6`
7. `0:0` only as final fallback

Because all 28 tiles are distributed among four players, all doubles are in players' hands.

The starting tile must be the qualifying double.

## 4. Normal turn rules

- Turns move in the configured table direction.
- A tile may be played only if one of its values matches one of the two open ends of the chain.
- If a tile can legally fit on either end, the player chooses the end.
- The server is authoritative and validates every move.
- A player may not play out of turn.
- A player may not play a tile that is not in their hand.
- A player may not make an illegal placement.

## 5. Pass

- If the current player has no legal move, the player passes.
- Passing when a legal move exists is not allowed.
- The server must be able to derive whether a pass is legal.

## 6. Normal round victory

A round normally ends when a player plays their final tile.

That player's **team** wins the round.

The value awarded for the round is based on the losing team's remaining tiles.

## 7. Tile point values

For normal tile scoring, a remaining tile contributes the sum of its two sides.

Examples:

- `6:4` → 10
- `5:2` → 7
- `3:3` → 6
- `0:5` → 5

### Special `0:0` rule

`0:0` counts as **10 points only when it is the player's only remaining tile**.

If `0:0` is present together with one or more other remaining tiles, it contributes its normal pip value of 0.

This special rule must be implemented exactly as written and covered by tests.

## 8. Opening the score — the 13-point rule

Each team begins the match in a **closed / unopened** scoring state.

To open its official score, a team must win a single round worth **13 points or more**.

### Pending points before opening

If an unopened team wins a round worth fewer than 13 points:

- those points are not yet added to the official match score;
- they are stored as that team's **pending opening points**;
- multiple consecutive wins under 13 may accumulate as pending points;
- the pending total by itself does **not** open the score.

Example:

- Team A wins 7 → pending = 7, official score = 0
- Team A wins 8 → pending = 15, official score = 0
- Team A wins 12 → pending = 27, official score = 0

Even though pending is now greater than 13, the score is still unopened because no single qualifying round of 13+ has occurred.

### Opening after a qualifying win

If the same unopened team later wins a round worth 13 or more before the opponent wins a round:

- the team becomes **opened**;
- all of its accumulated pending opening points are added;
- the qualifying round points are added;
- pending opening points reset to 0.

Example:

- 7 pending
- +8 pending
- +12 pending
- then a 15-point win
- official score becomes `7 + 8 + 12 + 15 = 42`
- team is now opened.

### Pending points burn

If an unopened team has pending opening points and the opposing team wins a round before that team opens:

- all pending opening points belonging to the first team are lost;
- they do not transfer to the opponent;
- they do not enter the SEKA bank;
- pending resets to 0.

Example:

- Team A pending = 27
- Team B wins the next round
- Team A pending → 0

### After a team has opened

Once a team has opened its score:

- the 13-point minimum no longer applies to that team;
- every later normal round win is added directly to its official score, even if the value is below 13.

Example:

- Team A is already opened at 42
- Team A wins 5
- official score becomes 47.

Opening status is tracked separately for each team.

## 9. Bağlanma ("fish" / blocked round)

A **bağlanma** occurs when the domino chain is blocked such that:

- neither open end can be legally played by any remaining tile in any player's hand; and
- no player has a legal move.

Operationally, once the game reaches the state where no player can make a legal move, the round ends as bağlanma.

The server must detect this deterministically.

## 10. Scoring bağlanma

When bağlanma occurs:

1. Calculate the total remaining tile points for Team A.
2. Calculate the total remaining tile points for Team B.
3. Apply the special `0:0` rule before comparing totals.

If the totals are different:

- the team with the **lower** remaining total wins the round;
- the winning team receives the losing team's remaining-point total as the round value.

Example:

- Team A remaining = 17
- Team B remaining = 25
- Team A wins
- round value = 25

That round value then goes through the same opening-score rules described above.

## 11. SEKA

If bağlanma occurs and both teams have exactly the same remaining-point total, the result is **SEKA**.

Example:

- Team A remaining = 25
- Team B remaining = 25
- SEKA value = `25 + 25 = 50`

No team wins that round.

The combined value is added to a separate shared **SEKA Bank**.

### SEKA Bank accumulation

The SEKA Bank persists across rounds until a later non-SEKA round has a winner.

If another SEKA occurs before the bank is claimed, its combined value is added to the existing bank.

Example:

- first SEKA: `25 + 25 = 50` → bank = 50
- second SEKA: `10 + 10 = 20` → bank = 70

### Claiming the SEKA Bank

The winner of the next non-SEKA round receives:

- the normal value of that round; plus
- the entire accumulated SEKA Bank.

Then:

- SEKA Bank resets to 0.

Example:

- bank = 50
- next normal round value = 35
- effective round value = 85
- bank resets to 0.

The resulting effective round value is then processed by the team's opening/closed state rules.

**Important:** SEKA Bank is separate from a team's pending opening points.

## 12. Who starts the next round

After a non-SEKA round, the **team that won the previous round** earns the right to start the next round.

Either partner on the winning team may be the starting player.

The partners choose who starts by agreement. The application must support this instead of automatically forcing a specific partner.

For MVP behavior:

- enter a `starter-selection` state before the next round;
- only the two players on the winning team are eligible to claim the start;
- the players may coordinate in text chat;
- the first valid starter selection made by an eligible winning-team member becomes the starter and is locked by the server;
- after the first round, the selected starter must open with any double they hold;
- if they hold multiple doubles, they may choose any of them;
- only if they hold no doubles may they open with any tile.

The first round of the entire match still follows the special double rule in Section 3.

### After SEKA

SEKA itself has no round winner. Therefore it does not create a new winning team for starter rights.

Starter rights do not change after SEKA. The previous starter/right-holder remains responsible. This also applies when SEKA occurs in the first played round: preserve that first round’s starter rather than choosing a new owner.

## 13. Match end

After applying all round points, including any claimed SEKA Bank:

- if a team's official score is `>= 101`, the match ends immediately;
- that team is the match winner.

## 14. Server authority

The backend is the source of truth for:

- shuffle;
- deal;
- player hands;
- turn order;
- legal moves;
- pass legality;
- chain state;
- bağlanma detection;
- tile scoring;
- pending opening points;
- opened/closed state;
- SEKA;
- SEKA Bank;
- round results;
- official scores;
- match winner.

Clients must never be trusted to calculate or submit authoritative game results.

## 15. Terminology for the codebase

Use these domain concepts consistently:

- `Match`
- `Round`
- `Team`
- `Player`
- `Tile`
- `Board`
- `Turn`
- `RoundResult`
- `ScoreState`
- `pendingOpeningPoints`
- `isScoreOpened`
- `baglanma`
- `seka`
- `sekaBank`
- `starterSelection`

Avoid using the generic word `bank` for pending opening points. `sekaBank` is the only shared bank.

## 16. Required rule tests

At minimum, automated tests must cover:

1. 28 unique tiles are generated.
2. Four players receive 7 unique tiles each.
3. First-round double priority.
4. Legal left placement.
5. Legal right placement.
6. Illegal tile rejection.
7. Out-of-turn rejection.
8. Pass allowed only with zero legal moves.
9. Normal round ends when a hand reaches zero tiles.
10. Normal losing-team tile sum.
11. `0:0` as only remaining tile = 10.
12. `0:0` with other remaining tiles = 0.
13. Unopened team wins 7 → pending 7.
14. Consecutive 7 + 8 + 12 remain pending and do not open score.
15. Pending points burn when opponent wins.
16. Pending 7 + 8 + 12 followed by 15 → opens at 42.
17. Opened team can add a later score below 13.
18. Bağlanma detection.
19. Bağlanma 17 vs 25 → lower-total team wins and earns 25.
20. Equal bağlanma 25 vs 25 → SEKA Bank +50.
21. Consecutive SEKA banks accumulate.
22. Next non-SEKA winner claims normal round value + full SEKA Bank.
23. SEKA Bank resets after claim.
24. Pending opening points and SEKA Bank remain separate.
25. Score 98 + 7 → 105 → match victory.
26. Winning team receives next-round starter-selection rights.
27. Losing team cannot select next-round starter.

28. Post-first-round starter must play a double if they hold one.
29. Starter may choose any held double, or any tile if they have no doubles.
30. SEKA preserves starter rights, including SEKA in the first played round.
