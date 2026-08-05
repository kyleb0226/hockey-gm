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

## Engine & realism

- **M** — Goalie fatigue and a real starter/backup split. A goalie who starts every night should
  see his save percentage sag; `p.fatigue` already exists but goalies ignore it. Add a rest model
  and have `autoLines` start the backup on the second half of a back-to-back.
- **M** — Shot quality zones. Split `resolveShots` into rush / cycle / point shots with different
  base save percentages, so a team of snipers and a team of grinders generate different-looking
  goal totals off the same shot count.
- **M** — Shootout as an actual event. Right now it's a coin flip weighted by top-line strength.
  Make it three rounds of shooter-vs-goalie using `hnd` against `rfx`, and record shootout
  win/loss on the goalie.
- **L** — Play-by-play for a single game. A "watch this game" view that steps through the
  matchups it already simulates and prints events (shot, save, goal, penalty) with a running
  clock. The engine produces all of this internally already; it just throws it away.
- **S** — Empty-net goals. Trailing by one inside the last two minutes, pull the goalie: a small
  chance to tie, a larger chance to concede.
- **M** — Fighting and momentum, gated behind the existing `fighting` rule knob, which is
  currently defined but unused.
- **S** — Back-to-backs in the schedule. Tag each fixture with days of rest and apply a small
  penalty to a team playing its second night in a row.

## GM depth

- **L** — Retained salary in trades. The `retainedSalary` rule knob exists but does nothing.
  Let a club keep up to 50% of an outgoing contract for its remaining term, tracked as a separate
  cap charge, with a limit on how many retentions a club can carry.
- **M** — Contract negotiation. Replace the one-click "Offer $XM × 3" in free agency with a real
  offer sheet: term, salary, and a counter from the player based on `marketValue`, his age, and
  whether the club is a contender.
- **M** — No-trade clauses. Star players over a rating threshold negotiate them; `evalTrade`
  refuses to move them without a waiver.
- **M** — Waivers. A player sent down who has played enough NHL games must clear waivers first,
  and a rival with cap space can claim him.
- **L** — Prospect development. Draftees currently sit on the farm and progress like everyone
  else. Give them a junior/AHL track with their own stat line, a development curve driven by
  `pot`, and a "ready for the NHL" signal.
- **M** — Trade deadline. A fixed matchday after which no trades are allowed, with AI clubs
  behaving as buyers or sellers in the weeks before it based on their playoff odds.
- **S** — Show traded picks in the trade screen. `G.picks` is fully modelled and `evalTrade`
  accepts picks, but the UI never offers them.

## Season & atmosphere

- **M** — Playoff series pages. A series view with the game-by-game scores, series leaders, and
  who's hurt, instead of the one-line summary in the bracket.
- **M** — Player pages. Click any name for career stats by season, trophies, contract history and
  a ratings breakdown. Nothing in the UI opens a player right now.
- **M** — Milestones and records. League record book (most goals in a season, longest win
  streak), plus a wire item when a player on your club approaches one.
- **S** — Streaks and a "hot/cold" flag on the roster page from the last ten games.
- **M** — An All-Star break: rosters voted from first-half stats, a skills competition result,
  and a real gap in the calendar.
- **L** — Club history pages. Per-club season-by-season records, Cup wins, retired numbers, and
  a franchise all-time roster, in the shape of soccer-gm's club history.

## Interface

- **S** — Sortable stat tables. Clicking a column header on the stats and roster tables should
  sort by it.
- **S** — A command palette (⌘K) to jump to any tab, club or player, matching soccer-gm's.
- **M** — Mobile layout pass. The tables scroll horizontally but the header wraps badly under
  400px and the lines editor is cramped.
- **S** — Keyboard shortcuts for sim controls: `d` for a day, `w` for a week.
- **M** — A schedule tab. There's no way to see upcoming fixtures — only today's game on the home
  screen.
- **S** — Save-slot management in the header, so you can switch or export a career without
  reloading.

## Housekeeping

- **M** — Prune career history on save. A save grows about 0.13 MB a season, so a twenty-season
  career approaches the localStorage ceiling. Compress `p.career` for retired players and drop
  `G.results` older than the current season.
- **S** — Move saves to IndexedDB with the current localStorage path as a fallback, the way
  soccer-gm does it.
