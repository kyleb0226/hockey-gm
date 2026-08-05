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
