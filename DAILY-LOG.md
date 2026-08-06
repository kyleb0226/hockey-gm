# Daily log

One line per autopilot run: what shipped, or why nothing did. The agent reads the last 30 days of
this file before choosing, so **nothing here gets built twice**. If you revert a day, add a line
saying why — that's how you tell it not to try again.

Format: `YYYY-MM-DD · SIZE · what shipped` — or `SKIPPED · reason`.

---

- 2026-08-05 · — · Initial build. 32-club league, line-matchup engine with special teams and
  overtime, 82/56/41-game schedules, divisional and seeded playoff formats, hard cap, trades,
  draft with a weighted lottery, free agency, ageing and progression, awards, save slots, and a
  117-assertion headless harness. Not an autopilot run — this is the starting line.
- 2026-08-05 · L · Cleared the entire opening roadmap in one pass, by hand rather than by
  autopilot. Engine: a real calendar with rest days and back-to-backs, shot-quality zones
  (rush/cycle/point) that decide both who shoots and how stoppable it is, defencemen added to the
  even-strength unit so they actually shoot, goalie fatigue and a starter/backup split, a real
  three-round shootout, empty-net situations, and fighting with a momentum swing. GM: retained
  salary, no-trade clauses, waivers, contract negotiation with counters, a trade deadline with AI
  buyers and sellers, and prospect development on the farm. Season: a record book, in-season
  milestones, an All-Star break carved out of the calendar, franchise history with honoured
  numbers, and per-zone shot tracking for skaters and goalies. Interface: rebuilt around grouped
  navigation with sortable tables everywhere, player pages with a shot-location rink, a
  play-by-play game viewer, club history pages, a schedule tab, playoff series pages, a command
  palette, keyboard shortcuts and save-slot management. Storage moved to IndexedDB with a
  synchronous localStorage mirror. Harness grew from 117 to 214 assertions.
  Bugs the harness and the browser pass caught along the way: ice time was being divided among
  linemates (a first-liner showed 4.7 minutes instead of 21); every club played every single day
  because all sixteen of a round's fixtures landed on one date; the circle method's fixed point
  gave every club identical rest; the draft silently ended at pick 32; scratches were credited
  with games they never dressed for; a club with two injured goalies crashed the engine; and
  saves were being lost to fire-and-forget IndexedDB writes.
- 2026-08-05 · S · Line chemistry: a forward line now tracks how many consecutive games it has
  played intact (`t.lineChem`/`t.lineSig`, capped at `LINE_CHEM_MAX_GAMES`) and earns a small
  `lineOff` bonus for it in `simGame`'s even-strength loop, so shuffling a line every week costs
  offence. Surfaced in the Lines tab with a per-line tooltip and a marker once a line is fully
  jelled. Along the way, retuned the "season milestones fired" harness check off seed 191, which
  put the user's top scorer exactly on the 20-goal threshold with no margin — any small change to
  shot rates could tip it either way, and this one did. Harness grew from 214 to 218 assertions.
- 2026-08-05 · M · Shot attempts and net placement, by hand rather than by autopilot. Every shot
  that reaches the net now has blocked and missed attempts rolled around it, so about 55% of
  attempts are on goal — and blocks are real, credited to an actual defenceman, so `blkd` and
  `blk` reconcile league-wide. On-goal shots are placed in one of nine `NET_CELLS`, the shape of a
  penalty placement chart: hands pick corners, weak shooters hit centre mass, and every goalie
  carries one permanent hole derived from his id. New `NetGrid` and `AttemptBar` components sit
  beside `ShotRink` on player pages, and a **Shot maps** tab aggregates all three by club for and
  against. Career rows now drop the zone and net buckets — carrying them was worth a megabyte over
  eight seasons. Harness grew from 218 to 231 assertions.
- 2026-08-05 · S · A shot-by-shot view of the net, by hand. `NetGrid` gained a `dots` mode that
  plots one dot per shot instead of a percentage — red goals, blue saves, hollow off-target dots
  scattered over the bar and wide of the posts, amber blocked shots in a band below the goal line.
  Positions come from a pure `jitter`/`scatter` pair seeded off the player id, so the cloud is
  stable between renders; one dot stands for several shots once a cell crowds. Toggle sits on both
  the player page and the Shot maps tab.
- 2026-08-05 · M · Real per-shot logs, by hand. `G.shotLog` and `G.gameLog` record every attempt
  and every game for the user's club — day, opponent, clock time, zone, net cell, outcome — so the
  net dots are now actual logged shots with a tooltip each rather than a density rendering, and
  player pages gained a form-bar chart and a game-by-game table. Kept to one club and cleared at
  the rollover, which is what stops it costing a megabyte. Also rewrote `scatter` to place dots at
  random points with a small spill across cell boundaries: the old jittered grid laid dots out in
  index order, which stacked every goal in the top-left of its cell and left the edges bare.
  Replaced the RNG-hostage milestone check with one that drives `checkMilestones` directly, after
  it broke for the second time on an unrelated change. Harness grew from 231 to 251 assertions.
