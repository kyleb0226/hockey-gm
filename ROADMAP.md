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

- **S** — Chemistry-aware auto lines. `autoLines` rebuilds a lineup from scratch by depth chart
  every time it's called (after an injury, a trade, a recall), which throws away whatever streak
  `lineChemistry`/`pairChemistry` had going even when the roster change doesn't touch that line or
  pair. Have it keep any line/pair untouched by the change instead of always sorting from zero.

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
- **S** — Surface player comparison from more places. `CompareModal` (shipped 2026-09-03) only
  opens from a `Compare` button inside `PlayerModal`, so getting to it always costs a full profile
  open first. Add it to the command palette as a direct "Compare players" action, and to
  `RosterTab` as a per-row affordance so two names on the same roster can be queued straight from
  the table.

## Housekeeping

- **M** — Memoise roster lookups. `rosterOf` calls `playersOf(G)` which scans every player in the
  league, and it's called several times per simulated game. A per-team index rebuilt on roster
  changes would cut a large slice of sim time.
