# Pocket GM — Hockey

Single-file React hockey-manager game (sibling of `~/soccer-gm` and `~/baseball-gm`). You run a
club in a 32-team, two-conference, four-division league: set the four forward lines, three
defence pairs and your goaltending, work the hard cap, sim the season, and chase the Cup.

**This repo is also the guinea pig for a daily autopilot.** A GitHub Action runs every morning,
picks one item off `ROADMAP.md`, builds it, and commits to `main` — but only if
`tools/simtest.js` still passes. See "The daily autopilot" at the bottom.

## Run it
- One static file: `index.html`. Serve the folder —
  `python3 -m http.server 8142 --directory ~/hockey-gm` → http://localhost:8142 — or open it
  directly.
- Registered in `~/.claude/launch.json` as **hockey-gm** (port 8142) for the preview tooling.
- No build step. React 18 + Babel-standalone + Tailwind, all vendored under `vendor/`.

## Architecture
- The app lives in a `<script type="text/babel-src" id="app-src">` block; an inline script at the
  bottom does `Babel.transform(src, {presets:[["react",{runtime:"classic"}]]})` then `eval`s it.
  The **classic** runtime is required — the default preset emits an ESM `import` that breaks in a
  non-module inline script.
- **State:** one `G` object in `App` `useState`, persisted per save-slot in localStorage. Shape
  changes go in `migrate(G)` rather than bumping the save key.
- **Randomness:** everything routes through `rnd(G)`, a seeded PRNG stored on `G.seed`. Never use
  `Math.random()` in engine code — the harness relies on the same seed replaying the same season.
- **World:** `TEAMS` (32 clubs, four divisions of eight, `DIV_CONF` maps division → conference).
  A club is its index into `TEAMS`; `G.teams[i]` carries the record and the lineup.
- **Players:** `G.players` keyed by id. Skaters carry `SKATER_KEYS`
  (sht/pss/hnd/spd/dfn/phy/fo/sta/dur), goalies carry `GOALIE_KEYS` (rfx/pos/reb/sta/dur), and
  `ovrOf(p)` weights them differently per position. `p.season` is the live stat line, `p.stats`
  is last season, `p.career` is the archive.
- **Calendar:** `buildSchedule(G)` runs the circle method over all 32 clubs and repeats it until
  `seasonLen` is met. Who plays whom comes from the rotation; **who is at home** comes from a
  running `homeCount`, so the split stays even however many times the cycle repeats.

## The match engine
This is deliberately NOT soccer-gm's xG model. Shots are generated per **line-vs-line matchup**,
which is what makes line construction and last change matter.

- `simGame(G, home, away, opts)` splits ~47 even-strength minutes across the four forward lines
  (`LINE_TOI`) and, for each, across the three opposing defence pairs (`PAIR_TOI`). Shot rate for
  a matchup is `(28/60) * lineOff(forwards) / unitDef(oppForwards, oppPair)`.
- **Last change:** at home, line 1 is skewed toward the opponent's third pair (`share *= 1.28`)
  and away from their first (`0.78`). That is the whole home-ice advantage — there is no flat
  bonus anywhere.
- `resolveShots` turns shots into goals against a goalie's save percentage
  (`0.9 + (quality - 55) * 0.0016`, clamped to .845–.965), picks the shooter weighted by
  `sht`/`hnd`, and assigns 0–2 assists weighted by `pss`. Even-strength goals move `+/-` on both
  sides.
- **Special teams** run separately: penalties drawn → PP minutes at a much higher shot rate,
  with a small chance of a shorthanded look the other way.
- **Overtime:** in the playoffs, and whenever the shootout is off, OT loops `resolveShots` until
  somebody scores, so every goal has a scorer. The **shootout is the one goal nobody is credited
  with** — the team's score goes up and no skater's total does, exactly as in real bookkeeping.
  The harness accounts for this; don't "fix" it by crediting a player.

## Rules, difficulty, money
- **`G.rules` / `RULES_DEFAULT` / `rules(G)`** — always read through `rules(G)` so a save that
  predates a knob still sees a complete object. `setRule(G,k,v)` routes **structural** knobs
  (`STRUCTURAL_RULES`: `seasonLen`, `playoffFormat`, `seriesLen`) into `G.pendingRules`;
  `applyPendingRules(G)` promotes them at the top of `startNextSeason`, before the calendar is
  rebuilt. `ruleValue(G,k)` reads staged-then-live (what the UI shows).
  - **`otLoserPoint`** — the loser point. Off means `pts === w*2` and nothing lands in OTL.
  - **`otFormat`** — `3on3` / `5on5` / `none`. `none` allows real ties.
  - **`playoffFormat`** — `divisional` (top 3 per division + 2 conference wildcards, the
    interesting one) or `seeded` (1–8). Both must produce exactly 8 first-round series.
  - **`hardCap` / `capAmount`** — the hard cap is the defining GM constraint. `evalTrade` and
    `signPlayer` both refuse to breach it.
- **Difficulty** (`DIFFICULTIES`, `diff(G)`) scales budget, AI asking prices, injury frequency and
  how sharply the board reacts. Pressure on the manager only — the AI never gets better
  information.

## Season lifecycle
`simDay` → … → `endRegularSeason` (awards + bracket) → `simPlayoffRound` × N → `finishSeason` →
offseason UI → `startNextSeason`.

**Ageing, progression, retirement and contract expiry all happen in `finishSeason`, not at the
rollover.** That is deliberate: it means the offseason screens show next year's ratings and a
real free-agent class instead of last year's leftovers. `startNextSeason` only advances the year,
runs `aiFreeAgency` + `fillRosters`, wipes the table and rebuilds the calendar.

## Gotchas
- `emptyBox` covers the **whole organisation** (farm and injured included) so a stray player id
  can never miss a lookup. `applyGame` then skips anyone with `toi <= 0`, which is what stops
  scratches being credited with a game. Both halves are load-bearing.
- `G.draftPick` counts picks made overall; `G.draftClass` shrinks as it goes. Never compare them
  to each other — that bug silently ended the draft at pick 32.
- `autoLines` falls back to the farm, then to any body, if both goaltenders are hurt. A team with
  no dressed goalie used to crash `resolveShots`.
- Lines are invalidated by setting `t.lines = null` (on injury, trade, recall). `ensureLines`
  rebuilds lazily — don't call `autoLines` directly from engine code.

## `tools/simtest.js`
Headless harness: extracts the `app-src` block, transpiles it with the vendored Babel, runs it in
a Node `vm` with minimal shims, and publishes the functions listed in `EXPORTS` (top-level
`const` doesn't become a vm global, hence the explicit epilogue). It plays full seasons over the
32-club world and checks world generation, schedule integrity for all three season lengths,
box-score reconciliation (player goals + shootout winners must equal team goals; goalie shots
faced must equal skater shots on goal), the points system, both playoff formats, the cap, trades,
the rollover, rule staging, lines, special teams, injuries, awards, save round-tripping, and
determinism.

```bash
node tools/simtest.js          # all checks
node tools/simtest.js season   # one check
```

**Add a case to `CHECKS` (and any new function to `EXPORTS`) when you add a feature.** A feature
with no check is a feature the autopilot can silently break tomorrow.

## The daily autopilot
`.github/workflows/daily.yml` runs every morning at 8am ET:

1. **Pick** one item — a `> **NEXT:**` line at the top of `ROADMAP.md` wins, then an open issue
   labelled `next`, then the top unblocked roadmap item. It may not repeat anything in the last
   30 days of `DAILY-LOG.md`.
2. **Build** it, then run `node tools/simtest.js` until green.
3. **Verify** independently in the workflow. If the harness fails, or if the number of assertions
   in the harness went *down*, the whole change is reverted and the day is logged as skipped.
4. **Commit** one commit to `main` and refill the roadmap.

**Size budget:** S or M Monday–Saturday, L allowed on Sundays. Items are tagged in `ROADMAP.md`.

**To steer it:** edit `ROADMAP.md` (reorder, delete, or add a `> **NEXT:**` line), or open an
issue labelled `next`. To undo a day: `git revert <sha>` and add a line to `DAILY-LOG.md` saying
why, so it doesn't try the same thing again.

**Rails the daily prompt enforces:** never touch `.github/`, never delete an existing feature,
no new dependencies or network calls, no `Math.random()` in engine code, and never weaken
`tools/simtest.js` to make a change pass.
