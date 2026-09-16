# Roadmap

The idea pool the daily autopilot draws from. **Edit this file to steer it.**

- Reorder items to change what gets built next.
- Delete anything you don't want.
- Add a `> **NEXT:** ...` line directly under this paragraph to jump the queue for one day.
- Every item is tagged **S** (an hour), **M** (an evening) or **L** (a real feature).
  The autopilot may only pick **L** on Sundays.

The agent removes what it ships and adds one or two fresh ideas each run, so this list should
never run dry. If it drifts somewhere you don't like, prune it — that's the steering wheel.

---

## Coaching and tactics

- **M** — Chemistry survives a whole-line reorder in name only. `lineChemistry`/`pairChemistry`
  key the streak off the slot index (`t.lineSig[li]`), not the trio, so bumping line 2 up to line
  1 with the new `moveLine` button (`LinesTab`) carries the same three players into a slot whose
  signature doesn't match and resets their streak to zero — exactly as if they'd been broken up.
  Comparing the incoming trio against every stored signature, not just its own slot's, would let a
  promoted line keep the games it already had.

## GM depth

- **M** — Three-way trades. `evalTrade` is written for two clubs; a third seat is where the
  genuinely interesting deals live. Not the same thing as `brokerTrade`, which only ever adds a
  cap-space dump for a fee — a real three-way exchanges players and picks in all three directions.

## Season and atmosphere

- **M** — Split the shot maps by situation. `ShotRink` and `NetGrid` aggregate everything
  together; even strength and the power play are different games, and `resolveShots` already
  knows the `strength` of every shot.
- **S** — Split the cycle zone into left and right wall. `SHOT_ZONES` has one `cycle` bucket that
  `ShotRink` draws as two mirrored boxes showing the same number, which is a small lie.

## Interface

- **M** — A season summary export: one page per completed year with the table, leaders, awards and
  the Cup run, printable and copy-pasteable.
- **M** — A dedicated goalie page in the player modal: workload chart by month, and rest-versus-
  save-percentage, now that both are tracked.
- **S** — Chemistry in the box score. `GameTab` replays `G.lastGame` but never shows which lines
  or D pairs were fully jelled (`t.lineChem[i] >= LINE_CHEM_MAX_GAMES`, and now `t.pairChem[i] >=
  PAIR_CHEM_MAX_GAMES`) going into that game; a small note next to the line score would make the
  chemistry bonus visible, not just felt.
- **S** — The "Cmp" queue (`RosterTab`, and now `StatsTab`) clears `cmpSel` back to `[]` the
  instant a second player is picked and `onCompare` fires, so checking one player against three
  or four rivals in a row means re-clicking "Cmp" on him every single time. Keeping `cmpSel[0]`
  pinned after the modal opens — only clearing on "Cancel" or a fresh player-A pick from inside
  `CompareModal` — would make that the one-click flow it's clearly meant to be.
- **S** — `PlayerPicker` (used by `CompareModal`) lets you pick any two players and only tells you
  they don't match — "Pick two players of the same kind" — after both are chosen. Filtering the
  second picker's search results by the first pick's `pos === "G"` would catch it before the
  wasted click instead of after.

## Housekeeping

- **M** — Memoise roster lookups. `rosterOf` calls `playersOf(G)` which scans every player in the
  league, and it's called several times per simulated game. A per-team index rebuilt on roster
  changes would cut a large slice of sim time.
