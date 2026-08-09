# Pocket GM — Hockey

Single-file React hockey-manager game (sibling of `~/soccer-gm` and `~/baseball-gm`). You run a
club in a 32-team, two-conference, four-division league: set the four forward lines, three
defence pairs and your goaltending, work the hard cap, sim the season, and chase the Cup.

**This repo is also the guinea pig for a daily autopilot.** A GitHub Action runs every morning,
picks one item off `ROADMAP.md`, builds it, and commits to `main` — but only if
`tools/simtest.js` still passes. See "The daily autopilot" at the bottom.

## On a phone
It's a PWA: `manifest.json`, icons, `sw.js` and the iOS meta tags are all in place, so Add to
Home Screen gives a standalone app. Two things to know:
- **`sw.js` uses paths relative to its own scope**, so the same file works at a domain root, under
  a `/hockey-gm/` subpath, or off a LAN address. soccer-gm hardcodes `/soccer-gm/` and breaks
  anywhere else — don't copy that.
- **The Babel output is cached in localStorage under a hash of the app source.** Transpiling ~5,000
  lines every load is fine on a laptop and painful on a phone (421ms → 165ms on desktop, far more
  on device). The hash means editing the source invalidates it automatically; there is no version
  to remember to bump. Older builds are deleted before a new one is written.
- A service worker needs HTTPS, so offline only works from a real deployment, not from a
  `http://192.168.x.x` LAN address.

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
- **Calendar:** `buildSchedule(G)` runs the circle method over all 32 clubs to decide **who plays
  whom**, a running `homeCount` to decide **who is at home**, and then spreads the fixtures across
  a real calendar of roughly `len * CAL_DAYS_PER_ROUND` days — an 82-game season runs ~176 days,
  so clubs have off nights and back-to-backs mean something. Two details are load-bearing:
  fixtures are placed by their index in the whole list, **not** by round (anchoring on the round
  drops all sixteen of a round's games on one night), and each round's fixtures are **shuffled**
  first, because the circle method has a fixed point — club 0 never moves — and without the
  shuffle every club lands in the same slot every round and every rest gap comes out identical.
  Three nights in midwinter are reserved for the All-Star break (`G.allStarDay`).
- **Rest:** `restFor(G, teamId)` reads `G.lastPlayed`. 0 means a genuine back-to-back, which costs
  a few percent of everything and pushes the backup goalie into the net.

## The match engine
This is deliberately NOT soccer-gm's xG model. Shots are generated per **line-vs-line matchup**,
which is what makes line construction and last change matter.

- `simGame(G, home, away, opts)` splits ~47 even-strength minutes across the four forward lines
  (`LINE_TOI`) and, for each, across the three opposing defence pairs (`PAIR_TOI`). Shot rate for
  a matchup is `(30.5/60) * lineOff(forwards) / unitDef(oppForwards, oppPair)`, times `momentum`
  (from a fight) and `legs` (from rest).
- **The unit on the ice is five skaters.** The forward line is joined by one of the side's own
  defence pairs, drawn by ice-time share. Without this, defencemen never shoot — they used to
  appear only in the *defensive* unit, and took 5% of shots instead of ~29%.
- **Ice time is per player, not per line.** Each player on the ice gets the full shift length. It
  is not divided among linemates — that bug made a first-liner look like a 4.7-minute player.
- **Last change:** at home, line 1 is skewed toward the opponent's third pair (`share *= 1.28`)
  and away from their first (`0.78`). That is the whole home-ice advantage — there is no flat
  bonus anywhere.
- **Line chemistry:** `lineChemistry(t, lines)` tracks, per forward line, how many consecutive
  games it has played with the same three players (`t.lineChem`/`t.lineSig`, capped at
  `LINE_CHEM_MAX_GAMES`) and is called once per side per game in the even-strength loop, which
  both reads the current streak and advances it. It feeds a small `lineOff` multiplier
  (`LINE_CHEM_PER_GAME`), so shuffling a line every week costs real offence. `pairChemistry(t,
  lines)` is the same idea for defence pairs (`t.pairChem`/`t.pairSig`, `PAIR_CHEM_MAX_GAMES`),
  feeding a `unitDef` multiplier (`PAIR_CHEM_PER_GAME`). Both are computed for each side **before**
  either side's shots are resolved, in their own pass at the top of the even-strength loop — a
  defending pair's continuity has to be known (it belongs to the *opponent* of the side generating
  shots) before that opponent's shot rate is calculated, so the two can't share the single
  attacker-only pass `lineChemistry` used alone.
- **Shot zones (`SHOT_ZONES`, `pickZone`):** every shot picks a zone first — rush, cycle or point
  — and the zone decides both *who* shoots (`dBias` makes the point a defenceman's shot) and *how
  stoppable* it is (`save` offsets the goalie's percentage). Conversion must stay ordered
  rush > cycle > point; the harness checks it.
  **The zone mix is NOT a league constant — it's an argument between the two units on the ice.**
  Speed up front turns pucks into rush chances, a defenceman who can shoot drags play out to the
  point, and a quick sound defensive unit denies the middle (less rush, more point against). It
  used to be fixed probabilities, which meant every club's shot map was the same shape and only
  the volume moved — a team's "for" and "against" maps looked identical. The harness now pins the
  spread across clubs AND the causal correlations (fast forwards → rush r>0.3, shooting D → point
  r>0.3, sound defence → less rush conceded r<-0.3), so flattening this back out will fail.
- **Attempts vs shots on goal. One attempt, one outcome.** `resolveShots` loops over ATTEMPTS, not
  over shots on goal: each attempt independently either hits a shin pad, sails wide, or reaches the
  goalie (~24% / 21% / 55%). `shots` is the number expected to reach the net, so the loop runs
  `shots / pOnGoal` times. It must NOT generate an on-goal shot and then invent a blocked and a
  missed sibling around it — that's what it used to do, and it meant one chance produced up to
  three records, so a player's shot chart drew three dots for one shot. **Blocks are real**,
  credited to an actual defenceman from `defIds`, which is why `blkd` and `blk` reconcile
  league-wide; with no defenceman modelled on the ice the attempt becomes a miss rather than an
  uncredited block. The invariants are `sog + miss + blkd === att` and one log record per attempt.
- **Net placement (`NET_CELLS`, `pickCell`, `goalieHole`, `shooterSpot`).** Every shot on goal is
  placed in one of nine cells, the shape of a penalty placement chart. **The table is calibrated
  against public NHL shot-target work, not invented**, and the point is that shots and goals pull
  in opposite directions: most shots are aimed LOW (the 3/4/5 holes), but about **67% of goals go
  in above the pads**, with top glove ~21%, high blocker ~15% and the five-hole ~14%. So each
  cell has a `w` (how often it's aimed at — low-heavy) and a `save` offset (how stoppable it is —
  top corners lethal). The engine reproduces this to within a point or two; the harness pins the
  shares, so **do not "simplify" the table without re-checking them**.
  **Shooters scout the goalie.** `pickCell` takes the keeper and boosts his `goalieHole` cell,
  harder for a player with hands. This is what makes a club's CONCEDED net map its own: without it
  placement depended only on the shooter, so every club's against-map was the league average and
  looked identical to its own. Every club now concedes above-average volume at its starter's hole
  (median +3 points); the harness pins it.
  A shooter bends the base distribution three ways: hands (can he elevate?), handedness
  (`p.shoots`, ~62% left league-wide — the real cause of the glove-side bias, since left shots come
  off the right wing), and `shooterSpot`, a favourite corner fixed by his id so no two charts look
  alike. **Every goalie has one permanent hole** from `goalieHole`. Placement is chosen *before*
  the save roll and genuinely affects it, which is why the save clamp runs to 0.55 — a top-corner
  shot has to be allowed to be nearly unstoppable. Empty-net goals get no placement, so the
  invariant is `sum(net[k].a) === sog - eng`.
- **League rates are calibrated and pinned:** ~.903 save percentage, ~9.6% shooting, ~30.5 shots
  on goal per team-game, ~3.1 goals. The harness asserts all four against real NHL bands, so a
  change to shot rates that quietly inflates scoring will fail rather than drift.
- `resolveShots` turns shots into goals against a goalie's save percentage
  (`0.9032 + (quality - 55) * 0.0016 - tired * 0.015`, plus the zone and net-cell offsets, clamped
  to .55–.99 — the wide low end is deliberate, so a top-corner shot can be near-unstoppable),
  and assigns 0–2 assists weighted by `pss`. Even-strength goals move `+/-` on both sides. Per-zone
  shots and goals are recorded on both the shooter and the goalie (`s.z` / `blankZones`).
- **Special teams** run separately: penalties drawn → PP minutes at a much higher shot rate,
  with a small chance of a shorthanded look the other way.
- **Goaltending:** `pickStarter` hands the net to the backup when the starter is worn down or it's
  a back-to-back — with a higher fatigue threshold when the backup is much worse. Goalies gain 14
  fatigue a start and shed 4.2 a day, which produces roughly a 55/27 split over 82 games.
- **The last two minutes:** trailing by one, the goalie comes out. Six-on-five can tie it, or the
  puck goes the other way — and an **empty-net goal has no goalie behind it**, so it adds to the
  shooter's `sog` and `eng` but charges no save opportunity. The invariant is
  `sum(zone shots) + eng === sog`.
- **Overtime:** in the playoffs, and whenever the shootout is off, OT loops `resolveShots` until
  somebody scores, so every goal has a scorer. `runShootout` is three rounds then sudden death,
  `hnd` against `rfx`, tracked in `sos`/`soa` and `sosa`/`sosv`. The **shootout is the one goal
  nobody is credited with** — the team's score goes up and no skater's total does, exactly as in
  real bookkeeping. The harness accounts for this; don't "fix" it by crediting a player.

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

## The draft
Seven rounds (`DRAFT_ROUNDS`), 224 prospects, and **you never see a prospect's true rating**.
Each carries `p.scout = {fog, bias, bias2}`; `scoutedOvr`/`scoutedPot` apply the bias scaled by
the fog, so the read is deterministic per player and only `scoutProspect` moves it. The top of the
board starts better known than the bottom. `SCOUT_POINTS` visits per offseason, each cutting a
prospect's fog to ~45% of what it was. **The AI drafts off `draftValue`, which is the FOGGED read
plus extra noise**, so thirty-two clubs genuinely disagree about the board.
`p.draft = {year, round, pick, teamId}` is stamped on the player for life and `G.draftLog` records
the pick-by-pick order. `closeDraft` deletes everyone left on the board — without it a hundred-odd
undrafted prospects leaked into `G.players` every year.

**Attrition is not optional.** Seven rounds puts 224 players a year into a league that loses ~50
to retirement, so without culling the save reached 4.9 MB in eight seasons. Two mechanisms in
`finishSeason`: stalled prospects (23+, still poor, nothing on their record) are released, and the
free-agent pool is hard-capped at `FA_POOL_MAX` — players who can't get a contract leave the
sport, keeping only those with trophies, rings or 200+ career games. That holds it at 2.7 MB.

## The club picker
`Splash` generates a REAL preview league with `newGame(0, {seed})` and hands the same seed to
`onStart`, so **the league you browsed is the league you manage**. That only works because world
generation reads the seed and never `userTeam` or `difficulty` — the `clubPicker` check pins it
for four different clubs and both difficulties. Break that and the preview silently becomes a
lie that nothing in the UI would reveal.
- `clubSummary(G, id)` builds the row: rating, best player, starting goalie, average age, cap
  space, prospect count and average prospect ceiling, coach, and an outlook band.
- **The outlook thresholds are MEASURED** (256 clubs over 8 seeds: range 47–80, median 65,
  quartiles 60/65/69). Guessed ones put all 32 clubs in "Contender". The harness fails if any
  single label swallows the league.

## Contracts
- **Demotion is free.** Moving a player between your own NHL roster and your own farm exposes him
  to nobody. Waivers used to gate this and made shuffling depth a gamble.
- **Waivers are for RELEASES.** `releasePlayer` puts him on the wire; another club can claim him
  and take the contract. If he clears he becomes a free agent and the club carries
  `RELEASE_DEAD_PCT` (a third) of his salary as dead cap for the remaining term.
  **Dead money must not follow the player** — `retainedOn` filters `dead` entries so his next club
  negotiates its own price, while `retainedBy` still sees it because that's the half that hits the
  cap. `retainedTraded` is the non-dead subset, used for the `MAX_RETAINED` trade limit.
- **You can re-sign your own.** `canExtend` (last year of the deal) → `extensionAsk`
  (`askingPrice` × `EXTEND_LOYALTY`) → `extendPlayer`. The extension REPLACES the expiring deal,
  so only the difference is new money against the cap.
- **AI clubs make real decisions.** `aiExtensionOffer` runs in `finishSeason` before contracts
  expire: core players and rising youngsters get kept, veterans and fringe players walk.
  **The baseline is deliberately low (0.1).** Starting from a coin flip meant clubs kept everybody
  — and since a signed player never enters the free-agent pool, he also never hit `FA_POOL_MAX`,
  so eight seasons put ~500 extra bodies in the save. The harness pins that clubs keep the better
  players and let the older ones walk.
- `FARM_MAX` was declared but never enforced; farms drifted past sixteen. `finishSeason` now trims
  each org to its best twelve and sends the rest to the market.
- **`p.stats` carries no `z`/`net` buckets.** Last season's shot maps are never rendered, and
  keeping nine net cells plus three zones on every player in the league cost ~0.3 MB. `migrate`
  strips them from old saves. Only `p.season` is live.

## The farm league
Prospects used to accumulate a stat line in a vacuum — no opponent, no result, nothing to win.
Every affiliate now plays a real league with a table and a championship.

- **Affiliates MIRROR the parent schedule.** When Hartford visit Boston, so do their farm clubs.
  That's a deliberate simplification: no second calendar to build, store or keep in sync, no way
  for the two to drift apart, and every farm game still has a real opponent and a real result.
- **The sim is coarse on purpose.** `simFarmGame` is strength-vs-strength, not the line-matchup
  engine — running the full engine 1,300 extra times a season would cost far more than it tells
  anyone. For the same reason a farm line carries **no zone or net buckets**.
- **Non-prospects are PHANTOM WEIGHT, not records.** A club carries only two to five prospects,
  but an affiliate ices `FARM_DRESSED` skaters; the rest is its own signed depth, modelled as
  weight in the scoring draw at `FARM_FILLER_OVR`. Giving each club ten more player objects would
  put three hundred dead rows back in the save. Without the phantoms, five prospects split every
  goal their club scored and the best of them finished on **138 goals in 82 games**.
- **A goal drawn to a phantom still generates assists.** Skipping the whole event when the scorer
  wasn't tracked cut league assists to a third of goals and buried every playmaker. Credit the
  goal only if the scorer is real, but always draw the helpers.
- `runFarmPlayoffs` seeds `FARM_CUP_FIELD` clubs, best-of-three, three rounds, resolved in one go
  at `endRegularSeason`. Winners get `t.farmCups` and `p.farmTitles`.
- `prospectReady` now also fires on farm production — a prospect outscoring the league is telling
  you he's finished learning there, whatever his rating says.

## Development
`progress(G, p)` runs **once a year, in `finishSeason`**, never in-season. The age curve (peak 26
for skaters, 28 for goalies) is the base; the interesting part is the environment term.

**NHL minutes are the best teacher in the sport, but only if he's actually playing them and
holding his own.** `devEnvironment(p, st, farm)` reads the season two ways — `role` (was he on the
ice?) and `perf` (did he hold his own?), both normalised per position by `DEV_BANDS` — and
combines them so that **role gates the whole term**: playing badly still teaches something, not
playing teaches nothing (`DEV_NHL_LO` is 0, deliberately — a buried player isn't punished, he just
gains nothing). Beating the farm takes roughly top-nine minutes *and* around-average production; a
productive fourth-liner is still better off in the minors. That trade-off is the point. It replaced
a flat "+1.5 if he's on the farm", which gave every prospect the same answer.

- **`DEV_BANDS` are MEASURED, not invented** — forwards run ~12.7 min a night at ~1.15 pts/60,
  defencemen ~16.2 and ~0.90, goalies ~.907. Re-measure against a simmed season before retuning
  them, or the thresholds stop meaning anything.
- **A mid-season move gets both**, weighted by games in each league, so a December callup is worth
  exactly the share of the year it covered. Note that AI clubs almost never shuttle players (3 of
  318 under-24s in a sample season), so in practice this mostly matters for the user's own callups.
- `devAgeWeight` tapers it out: full to 21, 0.75 to 23, 0.4 to 25, nothing after — where a player
  spends the year stops mattering once he's made.
- **Read `p.stats`, not `p.season`.** By the time `progress` runs, `finishSeason` has already done
  `p.stats = p.season` and blanked `p.season`. `p.farmSeason` is still intact (it's archived
  further down), and `p.age` has *already* been incremented, so the age gates are post-birthday.
- `DevelopmentNote` in the player modal surfaces all of this mid-season, while there's still time
  to act. It is the only place the model is visible — **the harness never renders it**.
- The `development` check in `tools/simtest.js` pins the corners (thriving/solid/buried/drowning),
  monotonicity in both inputs, the games-weighted blend, and that young regulars in a real simmed
  league develop far better than young scratches.

## Point shares
`pointShares(G, p, line)` is hockey's Win Shares — the closest thing the sport has to WAR that a
box score can produce — split into `ops` / `dps` / `gps` and measured in **standings points**.
It is a Point Shares-*style* estimate, not Hockey Reference's exact formula (that needs league
constants this engine doesn't produce). `GOALS_PER_POINT`, `REPL_SV`, `REPL_GC_PER_MIN` and
`DEF_POINTS_PER_MIN` were **solved numerically** so the league's shares sum to the standings
points actually handed out (~0.95) and the leader lands in the real 15–18 range. The harness pins
the sum, the leader, the positional composition, and the correlation with production — retune the
constants only against those.
Nothing is stored: it's derived from `p.season` (or any career row) on demand, so it costs no
save size.

## Seasons split by club
`p.stints` is a chronological list of spells — one slim stat line per club a player turned out for
this season, in order, created lazily by `stintFor(p, teamId)` in `applyGame`. It exists because
`p.season` alone credits a traded player's whole year to whoever happens to have him at the end.
The spell lines deliberately carry **no `z`/`net` buckets** (that's the save-size guard), and
`stintTotal(p, field)` must always reconcile with `p.season`.
At the rollover `finishSeason` archives a traded year as **one career row per club** — the way a
real record book reads — and a player who stayed put gets exactly one. `p.stints` is then cleared.
Playoff stats are not split.

## The logs
`G.allStar.at` snapshots the club each selection was picked from — a deadline trade to the other
conference must not retroactively move a player to the other bench.

`G.shotLog` and `G.gameLog` are keyed by player id and kept **only for the user's club** — doing
it league-wide would add well over a megabyte to a save for data nobody opens. `recordLogs` files
them in `applyGame`: one record per shot attempt (day, opponent, clock time, zone, net cell,
outcome `g`/`s`/`m`/`b`/`e`, strength) and one row per game. A goalie's shot log holds only the
attempts that actually reached him. Both are capped (`SHOT_LOG_MAX`, `GAME_LOG_MAX`) and both are
**cleared at the rollover** — they're a this-season view. As with the play-by-play, the game and
the outcome are real; the clock time within the game is generated.

## Deployment, the staff and the room
- **Ice time** (`t.iceF`, `iceTimeF`) is a per-club split, normalised on read, so a save without
  one plays the standard 30/27/24/19. Riding a line costs fatigue, which is already wired.
- **Matchups** (`t.checkLine`, `matchupMix`) decide which of THEIR lines each of yours sees.
  Line-for-line is the default; a checking line chases their best and the scoring line is steered
  toward their depth. **Last change is the whole point**: the effect is 0.62 at home and 0.22 away.
- **Coaching** (`SYSTEMS`, `coachOf`): the system multiplies shot rate in the same place `momentum`
  and `legs` do — ours pushes our volume, theirs decides what they allow. `pp`/`pk` move special
  teams, `dev` moves prospect progression in `progress()`.
- **Rivalries** (`t.rivalId`, `isRivalry`) are paired inside a division, so they're always mutual
  and nobody is left out. A rivalry night plays 4.5% harder both ways and fights nearly double.
- **The room**: `personalityOf` is derived from the player id, so it's stable for a career and an
  old save gets one for free. It is pure character and **never touches a rating**. `letters()`
  computes the C and the two A's from `leadership()` on the fly rather than storing them, so a
  trade can't leave a departed player wearing the C; `t.captainId` overrides it.
- **The board's ask** (`MANDATES`, `setMandate`, `seasonAchievement`): set from team strength at
  every rollover and judged when the Cup is handed out, so `boardConfidence` moves against a
  stated expectation instead of a flat did-you-make-the-playoffs.
- **Hall of Fame** (`hofScore`, `runHallOfFame`): eligible `HOF_WAIT` years after retiring, capped
  at `HOF_CLASS_MAX` a year over `HOF_BAR`. Inductees are exempt from `pruneSave`.
- **The block** (`setBlock`, `generateOffers`, `acceptOffer`): listing a player invites offers
  every fifth day; the AI still has to want him and be able to fit him.
- **Draft-day picks**: `tradablePicks` includes this year's picks whose slot hasn't come up yet.
  `seedPicks` starts at the CURRENT year — seeding only future years meant the first draft had no
  tradeable picks at all. Only `PICK_ROUNDS` rounds are tradeable; the rest fall back to `orig`.

**A React component that doesn't exist still passes the harness** — the harness never renders. A
UI addition needs a browser pass; two components were silently missing while 448 checks were green.

## The GM layer
- **Retained salary** (`G.retained`, `effectiveCap`, `retainedBy`): a club keeps up to
  `RETAIN_MAX_PCT` of a contract it trades away, for the contract's full remaining term, capped at
  `MAX_RETAINED` per club. `capHit` = roster contracts *less* what others retain on them, *plus*
  what this club retains for others.
- **No-trade clauses** (`eligibleForNtc`, `hasNtc`, `requestNtcWaiver`): attach to established
  players at signing. `evalTrade` refuses outright; the odds of a waiver rise with how badly the
  club is doing.
- **Waivers** (`needsWaivers`, `sendDown`, `processWaivers`): past `WAIVER_EXEMPT_GAMES` NHL
  games a player must clear waivers before going down. Claims are processed worst-club-first the
  following day.
- **Negotiation** (`askingPrice`, `negotiate`): term and the club's position in the table both
  move the number. A near miss returns a `counter`; a lowball returns nothing.
- **The deadline** (`deadlineDay`, `tradesOpen`): trades close at 74% of the calendar and stay
  shut through the playoffs. `aiDeadlineMoves` runs on the day and sorts the league into buyers
  and sellers.
- **Prospects** (`isProspect`, `prospectReady`, `simFarmDay`): farm players accumulate a
  `farmSeason` line. Whether that beats an NHL seat is the whole question — see "Development".

## Continuity of the shot log
The dots on a shot chart **are the shots from the games that were played** — recorded inside
`resolveShots` as each game runs, with that game's day and opponent, not generated afterwards to
match a total. The `continuity` check pins this: every logged shot must fall on a day the club
actually played, must name the opponent it was actually against, must add up to the season totals,
must grow incrementally as days are simmed rather than in one lump, and every logged goal must be
a goal that appears in `G.results`. If a change ever makes the chart cosmetic, that check fails.
Playoff records are logged too and stamped `po: true`; the player page filters them out so a
season chart shows season shots. Don't mix them.

## Season lifecycle
`simDay` → … → `endRegularSeason` (awards + bracket) → `simPlayoffDay` × N → `finishSeason` →
offseason UI → `startNextSeason`.

**The postseason is played a game at a time.** `simPlayoffDay` plays one game in every series
that's still alive and ticks `G.day`, so a seven-game series is lived through rather than resolved
in a click; `simPlayoffRound` is a fast-forward that loops it. Both share `advancePlayoffRound`,
so the two paths can't disagree about how the bracket moves. The user's playoff games get the same
`events` and `log` treatment his regular-season games get.

**Ageing, progression, retirement and contract expiry all happen in `finishSeason`, not at the
rollover.** That is deliberate: it means the offseason screens show next year's ratings and a
real free-agent class instead of last year's leftovers. `startNextSeason` only advances the year,
runs `aiFreeAgency` + `fillRosters`, wipes the table and rebuilds the calendar.

## Interface
- Tabs are grouped (`TABS`, `GROUPS`) into Club / League / Market / History rather than one long
  strip. `SortTable` is the single sortable table used by every screen — add columns to it rather
  than writing another `<table>`.
- `PlayerModal` and `ClubModal` open from anywhere; almost every name and row is clickable.
- **Three chart components, all driven off the same buckets and reused for players and clubs:**
  `ShotRink` (where on the ice), `NetGrid` (where in the goal), `AttemptBar` (on goal / missed /
  blocked). Each takes `mode="S"` for a shooter's view or `mode="G"` for a goalie's, and `NetGrid`
  takes an optional `hole` to outline a goalie's weak spot. `NetGrid` has two views: `pct` shades
  each cell and prints a rate, `dots` plots **one dot per shot** — red for goals, blue for saves,
  hollow around the frame for off target, amber in a band below for blocked, purple in the middle
  for empty-netters. When `G.shotLog` has records for that player the dots are **real** — one per
  logged shot, each with a `<title>` giving the opponent, day, clock time, zone, placement and
  outcome — and it falls back to a density rendering of the per-cell counts for anyone outside
  your club. Positions come from `jitter`/`scatter`, which places dots at genuinely random points
  with a small `spill` so a shot can straddle a gridline: the cell is how the shot was counted,
  not a wall. Placement must NOT be laid out in index order — records arrive grouped by outcome,
  so a grid layout put every goal in the top-left of its cell. The **Shot maps** tab
  (`AnalyticsTab` / `teamShotProfile`) aggregates the same data by club, for and against.
- Career rows deliberately **drop `z` and `net`** when archived in `finishSeason`. Carrying nine
  net cells and three ice zones per player per season is what pushed a long save past the storage
  ceiling; the shot maps are a current-season view.
- `GameTab` replays `G.lastGame`, which holds the **user's most recent game only** — a full
  season of play-by-play would dwarf everything else in the save. Events carry an invented clock
  time and are sorted; the events themselves are real.
- ⌘K / `?` opens the command palette; `d` and `w` sim a day and a week; **`n` does whatever the
  header's primary button does in any phase** — play a day, play a round, or take the next
  offseason step.
- **The offseason is a sequence with exactly one next action, always in the same place.**
  `offseasonStage(G)` derives where you are from state (never a stored field that can go stale),
  `offseasonAction(G)` names the next step, `doOffseasonStep(G)` performs it. The header renders it
  where the sim controls live during the season, and `OffseasonTab` repeats it above the fold with
  a Review → Draft → Free agency breadcrumb. Don't bury the advance button under the free-agent
  table again — that was the original complaint.

## Gotchas
- `emptyBox` covers the **whole organisation** (farm and injured included) so a stray player id
  can never miss a lookup. `applyGame` then skips anyone with `toi <= 0`, which is what stops
  scratches being credited with a game. Both halves are load-bearing.
- **A negative base to a fractional power is `NaN`.** `(p.ovr - 32) ** 1.6` looks harmless until a
  player is rated under 32; then every weight is NaN, every comparison is false, and a weighted
  draw silently hands everything to the last item in the list. On a thin affiliate that gave one
  prospect all 154 of his club's goals and the whole roster zero assists — and league *averages*
  hid it completely. Clamp the base at zero.
- **`SortTable` remembers its sort column, and React reuses the instance across sibling branches.**
  Two different tables rendered at the same position in a `? :` share one component, so a sort key
  from one carried into the other, matched nothing, and fell back to sorting by name. Give each a
  distinct `key` when the columns differ.
- **In a bracket, ORDER IS THE STRUCTURE.** `advancePlayoffRound` pairs adjacent survivors (slots
  2i and 2i+1), so `buildBracket` must push round one with the series that are meant to meet
  sitting next to each other: `[1v8, 4v5, 2v7, 3v6]` seeded, and each division's two series
  adjacent in the divisional format. Listing all the top-seed openers first put the 1 and 2 seeds
  in the SAME half — they met in round two instead of the conference final, and both formats were
  wrong for months because every other playoff check still passed. The `seeding` check pins it.
- The goalie scouting report reads `p.season.net` — what he has ACTUALLY conceded — not
  `goalieHole`. The hole is real and bends `pickCell`, so evidence correlates with it (~13% of
  reports name it, against an 11% chance floor) but must not simply echo it; the harness pins both
  bounds. Printing the hole directly meant the note said the same thing on day 1 as on day 82.
- `G.draftPick` counts picks made overall; `G.draftClass` shrinks as it goes. Never compare them
  to each other — that bug silently ended the draft at pick 32.
- `autoLines` needs **two** healthy goaltenders dressed and calls the farm up when it only has
  one — with nobody to hand the net to, `pickStarter` rides the starter and he ends up playing
  nearly every night. It falls back to the least-injured body if the whole organisation is hurt;
  a team with no dressed goalie used to crash `resolveShots`.
- `fillRosters` enforces its position minimums on the **dressed roster**, not the organisation.
  Counting the farm left clubs with their second goalie in the minors.
- Read a lineup through `ensureLines`, never `t.lines` — an injury nulls it and it is only
  rebuilt lazily at the next game.
- Lines are invalidated by setting `t.lines = null` (on injury, trade, recall). `ensureLines`
  rebuilds lazily — don't call `autoLines` directly from engine code.
- **Injuries are quoted in games, not days.** They only tick down for clubs that actually played
  that calendar day.
- **A traded player takes his season totals with him.** Reconciling goals per club must use the
  scoring records in `G.results`, not `p.season.g` against `p.teamId`.
- **`saveGame` writes localStorage synchronously and IndexedDB in the background**, both wrapped
  as `{at, data}`, and `loadGame` takes whichever is newer. An earlier version wrote only to
  IndexedDB fire-and-forget and silently lost saves. `unwrap` still reads the old bare format.
- UI state that mirrors engine state goes stale. `OffseasonTab` derives its step from `G.phase`
  rather than trusting `G.offseasonStep`, because a completed rollover otherwise leaves a draft
  board on screen.
- The Hall of Fame check ("players get inducted over a long career") is **thin by nature** — a
  healthy league inducts 1–5 over twelve seasons, so a single seed returning 0 is weak evidence of
  a regression. Before tuning anything to fix it, sweep several seeds under both the old and new
  code and compare the distributions; a change to progression shifts every downstream outcome even
  when the RNG call count is identical.
- Milestones and honours use **rates scaled to the season length**, not raw totals — a 41-game
  season would never reach a 50-goal mark or a 300-point career.
- `tools/simtest.js`'s "season milestones fired" check (`atmosphere`) picks a fixed seed and
  checks a real player's season line against a scaled integer threshold. A seed that lands the
  user's top scorer *exactly* on the threshold has no margin — any small, unrelated change to
  shot rates can flip it. If a change you didn't expect to touch scoring trips this check, prefer
  swapping to a seed with real margin over touching the threshold itself.

## `tools/simtest.js`
Headless harness: extracts the `app-src` block, transpiles it with the vendored Babel, runs it in
a Node `vm` with minimal shims, and publishes the functions listed in `EXPORTS` (top-level
`const` doesn't become a vm global, hence the explicit epilogue). It plays full seasons over the
32-club world and checks world generation, calendar integrity and rest distribution for all three season lengths,
box-score reconciliation (player goals + shootout winners must equal team goals; goalie shots
faced must equal skater shots on goal), the points system, both playoff formats, the cap, trades,
the rollover, rule staging, lines, special teams, injuries, awards, save round-tripping, and
determinism, plus goaltending workload, shot zones, retained salary, waivers, negotiation, the deadline, prospects, records, the All-Star break, play-by-play, an eight-season soak and save durability.

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
