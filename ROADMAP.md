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

- **L** — Matchup control. The engine already gives the home side last change, but you can't use
  it: `simGame` hardcodes the bias in the even-strength loop. Let the user pick a checking line
  and a shutdown pair to chase a named opponent, and let the AI counter at home.
- **M** — Team systems. A forecheck setting (aggressive / balanced / trap) that trades shot volume
  against shots allowed, applied as a multiplier in the same place `momentum` and `legs` are.
- **M** — Goalie pull strategy. The last-two-minutes block uses fixed 17%/28% odds; make when to
  pull a user setting (down one from 2:00, from 1:00, never) with the payoff moving accordingly.
- **S** — Line chemistry. Track how many games a forward line has played intact and give a small
  `lineOff` bonus once it's settled, so shuffling every week has a cost.

## GM depth

- **L** — Long-term injured reserve. Injuries over ~25 games should be placeable on LTIR for cap
  relief, with the space vanishing when the player is activated. `rollInjuries` already produces
  the long ones; nothing does anything with them.
- **M** — Contract buyouts. Pay off a bad deal for a fraction over double the term, tracked in
  `G.retained` alongside retained salary since the cap plumbing is already there.
- **M** — The trade block. Let the user list players as available, and have AI clubs open with
  offers instead of only ever answering. `aiDeadlineMoves` has most of the valuation logic.
- **M** — Scouting. Draft prospects should show fuzzed ratings that tighten as you spend scouting
  budget on them, so `autoDraft` picking pure `pot` stops being the optimal strategy.
- **S** — Pick protections. `G.picks` records owner and origin but nothing else; add
  lottery-protected and top-10-protected picks that roll over a year if they land in range.
- **M** — Three-way trades. `evalTrade` is written for two clubs; a third seat is where the
  genuinely interesting deals live.

## Season and atmosphere

- **M** — Awards voting shares. `computeAwards` picks a single winner off one stat; make it a
  weighted ballot with the top five and their vote shares, which reads far better on the
  offseason screen.
- **L** — An international tournament in the break, using the All-Star selection logic to build
  national squads from `FIRST`/`LAST` name origin.
- **M** — Farm standings. Farm players produce a stat line but play in a vacuum — give the farm a
  table and a champion so prospects have something to win.
- **S** — Player comparison. Two players side by side with their ratings bars and shot rinks
  overlaid; the `ShotRink` component already takes any zone object.
- **M** — Opponent shot maps. Aggregate the zone data by *club* as well as by player, so you can
  see which zones your side concedes from and adjust pairs accordingly.

## Interface

- **M** — A season summary export: one page per completed year with the table, leaders, awards and
  the Cup run, printable and copy-pasteable.
- **S** — Save export and import as a JSON file, so a career can move between browsers.
- **S** — Club colours. `TEAMS` has no palette; two colours per club would lift the standings,
  bracket and box score at once.
- **M** — A dedicated goalie page in the player modal: workload chart by month, and rest-versus-
  save-percentage, now that both are tracked.

## Housekeeping

- **M** — Memoise roster lookups. `rosterOf` calls `playersOf(G)` which scans every player in the
  league, and it's called several times per simulated game. A per-team index rebuilt on roster
  changes would cut a large slice of sim time.
- **S** — Split the vendored Babel transform out of page load. The game transpiles ~2,700 lines on
  every open; caching the compiled output in IndexedDB keyed by a hash of the source would make
  a reload near-instant.
