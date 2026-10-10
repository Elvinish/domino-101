# Dynamic tabletop decoration

The home-table scene has a decorative-only layer in `TableDecor.tsx` and
`tableDecorData.ts`. It is deliberately outside the game snapshot and command
path: it reads only the room id, match id and public round number from
`TableScene`.

## Selection and lifecycle

- The pool contains **61** small drinks, fruit, snacks and household objects.
- **18** curated combinations contain two items, with one three-item cigar set
  for occasional variety.
- `tableDecorSeed(roomId, matchId, roundNumber)` is the complete seed. A seeded
  FNV-style hash selects one unique combination for each of the four relative
  seats (`top`, `left`, `right`, `bottom`). The same seed therefore produces the
  same layout after rerender, reconnect or navigation, while a new match or
  round produces a new table arrangement.
- The React layer crossfades the old and new sets for 560 ms when the seed
  changes. It never emits a socket event, changes a game action or stores
  client state.

## Presentation and accessibility

Desktop seats are anchored near the corresponding table edge so the central
chain, seat copy, held tiles and controls remain clear. Tablet keeps only the
small side-pocket props; the top and bottom pockets are hidden when their
cards or controls would become crowded. Phone CSS hides the decorative layer
to keep the compact board readable. The layer and all descendants use
`pointer-events: none`, are `aria-hidden`, and therefore cannot intercept
gameplay input.

Steam, smoke, candle flicker, plant sway and reflective glints are intentionally
slow and low contrast. Static props remain static. `prefers-reduced-motion:
reduce` disables every decoration animation and the seed-change transition.

The pure selection functions are covered by `tableDecor.test.tsx` for pool and
combination size, deterministic seeds, independent seats, round/match changes
and reconnect-equivalent rerenders. Browser bot coverage also checks four
rendered seat groups, seed identity, reduced motion and non-interactive
pointer behavior at desktop, tablet and phone projects.
