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

- **S** — `doTrade` (index.html, `news(G, \`Trade with ...\`)`) nulls both clubs' lines but never
  calls `lineupChangeNote` the way `rollInjuries` and `recall` do, so a trade that breaks up a
  jelled line or pair says nothing about it — the one roster event most likely to force a real
  reshuffle is also the one the news feed stays silent on.
- **S** — Let a user reorder whole lines, not just swap two players. `LinesTab`'s `swap` only
  exchanges the occupants of two slots; there's no "move winger up to line 1, bump the rest down"
  affordance, which is the more common real adjustment a coach makes.

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
- **S** — Extend the roster "Cmp" queue (shipped 2026-09-11 in `RosterTab`) to `StatsTab`. That's
  the screen where you're actually looking at a rival's rate stats next to your own player and
  wondering how they stack up — the same two-click queue-and-compare would fit it directly.

## Housekeeping

- **M** — Memoise roster lookups. `rosterOf` calls `playersOf(G)` which scans every player in the
  league, and it's called several times per simulated game. A per-team index rebuilt on roster
  changes would cut a large slice of sim time.
