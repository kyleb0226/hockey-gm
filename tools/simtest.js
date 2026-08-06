#!/usr/bin/env node
/*
 * Headless sim harness for Pocket GM — Hockey.
 *
 * The whole game is one <script type="text/babel-src"> block inside index.html.
 * This pulls that block out, transpiles it with the vendored Babel, and runs it
 * in a Node vm with just enough browser shim (localStorage / document / React)
 * that the module-level code can execute. No component is ever rendered — the
 * checks reach in and call the simulation functions directly.
 *
 * This is the gate the daily autopilot must pass. A change that breaks a check
 * here never reaches main.
 *
 *   node tools/simtest.js            # every check
 *   node tools/simtest.js season     # one check
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

// Top-level const/let don't become vm globals, so the epilogue publishes these.
const EXPORTS = [
  "newGame", "migrate", "simDay", "simDays", "simGame", "applyGame",
  "buildSchedule", "endRegularSeason", "buildBracket", "simPlayoffRound", "finishSeason",
  "startNextSeason", "buildDraftClass", "autoDraft", "draftPlayer", "pickOwner", "inPlayoffs",
  "rules", "setRule", "ruleValue", "applyPendingRules", "RULES_DEFAULT", "STRUCTURAL_RULES",
  "standings", "divStandings", "confStandings", "playoffField",
  "capHit", "capSpace", "capFloor", "marketValue", "teamStrength",
  "rosterOf", "activeRoster", "playersOf", "autoLines", "ensureLines",
  "evalTrade", "doTrade", "signPlayer", "aiFreeAgency", "computeAwards",
  "pts", "svPct", "gaa", "ovrOf", "TEAMS", "DIVS", "CONFS", "ROSTER_MAX", "POS",
  "DIFFICULTIES", "LINE_TOI",
  "pickStarter", "runShootout", "restFor", "SHOT_ZONES", "fillRosters",
  "deadlineDay", "tradesOpen", "daysToDeadline", "aiDeadlineMoves",
  "hasNtc", "eligibleForNtc", "requestNtcWaiver",
  "needsWaivers", "sendDown", "recall", "processWaivers", "nhlGames",
  "askingPrice", "negotiate", "isProspect", "prospectReady", "simFarmDay",
  "effectiveCap", "retainedBy", "retainedOn", "MAX_RETAINED", "RETAIN_MAX_PCT",
  "updateRecords", "checkMilestones", "runAllStar", "allStarRosters", "RECORD_DEFS",
  "pruneSave", "ZONE_KEYS", "NET_CELLS", "NET_KEYS", "goalieHole", "shooterSpot", "pickCell", "blankNet", "saveGame", "loadGame", "slotMeta", "unwrap", "deleteSlot", "localStorage",
  "lineChemistry", "LINE_CHEM_MAX_GAMES",
];

/* ------------------------------- load the app ---------------------------- */
function loadGame() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const m = html.match(/<script type="text\/babel-src" id="app-src">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("couldn't find the app-src block in index.html");

  const babelSandbox = { window: {}, self: {}, console, process, setTimeout, clearTimeout };
  babelSandbox.global = babelSandbox;
  vm.createContext(babelSandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "vendor/babel.min.js"), "utf8"), babelSandbox);
  const Babel = babelSandbox.Babel || babelSandbox.window.Babel;
  if (!Babel) throw new Error("vendored Babel didn't expose a Babel global");

  let code = Babel.transform(m[1], { presets: [["react", { runtime: "classic" }]] }).code;
  code += `\n;globalThis.__APP__ = {${EXPORTS.map((n) => `${n}: typeof ${n} !== "undefined" ? ${n} : undefined`).join(", ")}};`;

  const noop = () => {};
  const store = new Map();
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Math, Date, JSON,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
    document: { getElementById: () => null, addEventListener: noop, removeEventListener: noop },
    navigator: { userAgent: "node" },
    location: { reload: noop },
    React: {
      createElement: (...a) => ({ _el: a }),
      useState: (v) => [typeof v === "function" ? v() : v, noop],
      useEffect: noop, useRef: (v) => ({ current: v }), useMemo: (f) => f(),
      useCallback: (f) => f, useContext: () => noop,
      createContext: () => ({ Provider: noop, Consumer: noop }),
      Fragment: "fragment",
    },
    ReactDOM: { createRoot: () => ({ render: noop }) },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "app-src.js" });

  const A = sandbox.__APP__;
  const missing = EXPORTS.filter((n) => A[n] === undefined);
  if (missing.length) console.log(`  \x1b[33m! not exported: ${missing.join(", ")}\x1b[0m`);
  return A;
}

/* --------------------------------- helpers ------------------------------- */
let failures = 0, checksRun = 0;
function ok(cond, label, detail) {
  checksRun++;
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else { failures++; console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? `\n      ${detail}` : ""}`); }
}
function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`); }

function simSeason(A, G) {
  let guard = 0;
  while (G.phase === "regular" && guard++ < 400) A.simDay(G);
  return G;
}
function simPlayoffs(A, G) {
  let guard = 0;
  while (G.phase === "playoffs" && guard++ < 12) A.simPlayoffRound(G);
  return G;
}
// The schedule is a CALENDAR now, not one round per day, so "how long is the
// season" means games per club rather than schedule.length.
function gamesPerTeam(G) {
  const count = new Array(G.teams.length).fill(0);
  G.schedule.forEach((day) => day.forEach((f) => { count[f.home]++; count[f.away]++; }));
  return count;
}

/* --------------------------------- checks -------------------------------- */
const CHECKS = {
  // World generation: 32 clubs, legal rosters, everyone under the cap.
  world(A) {
    section("World generation");
    const G = A.newGame(0, { seed: 11 });
    ok(G.teams.length === 32, `32 clubs (got ${G.teams.length})`);
    ok(A.DIVS.length === 4, "four divisions");
    const perDiv = A.DIVS.map((_, d) => G.teams.filter((t) => t.div === d).length);
    ok(perDiv.every((n) => n === 8), `eight clubs per division (${perDiv.join("/")})`);

    const thin = G.teams.filter((t) => A.rosterOf(G, t.id).length < 18);
    ok(thin.length === 0, "every club dresses a full roster",
      thin.length ? `${thin.length} clubs under 18` : "");
    const noG = G.teams.filter((t) => A.rosterOf(G, t.id).filter((p) => p.pos === "G").length < 2);
    ok(noG.length === 0, "every club carries two goaltenders", noG.length ? `${noG.length} short` : "");
    const noD = G.teams.filter((t) => A.rosterOf(G, t.id).filter((p) => p.pos === "D").length < 6);
    ok(noD.length === 0, "every club carries six defencemen", noD.length ? `${noD.length} short` : "");

    const over = G.teams.filter((t) => A.capHit(G, t.id) > A.rules(G).capAmount);
    ok(over.length === 0, "no club starts over the cap",
      over.length ? over.map((t) => `${t.abbr} $${A.capHit(G, t.id)}M`).join(", ") : "");

    const ovrs = A.playersOf(G).map((p) => p.ovr);
    const avg = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
    ok(avg > 40 && avg < 75, `ratings sit in a sane band (avg ${avg.toFixed(1)})`);
    ok(Math.max(...ovrs) >= 80, `the league has stars (best ${Math.max(...ovrs)})`);
  },

  // The schedule must give every club exactly the season length, home and away.
  schedule(A) {
    section("Schedule");
    [82, 56, 41].forEach((len) => {
      const G = A.newGame(0, { seed: 5, rules: { seasonLen: len } });
      ok(G.schedule.length > len * 1.5 && G.schedule.length < len * 3,
        `seasonLen=${len} → a real calendar with off days (${G.schedule.length} days for ${len} games)`);
      const count = new Array(32).fill(0), home = new Array(32).fill(0);
      G.schedule.forEach((day) => day.forEach((f) => {
        count[f.home]++; count[f.away]++; home[f.home]++;
      }));
      ok(count.every((c) => c === len), `every club plays ${len}`,
        `min ${Math.min(...count)} max ${Math.max(...count)}`);

      // Rest has to actually vary: some back-to-backs, but not all of them.
      const days = new Array(32).fill(null).map(() => []);
      G.schedule.forEach((day, d) => day.forEach((f) => { days[f.home].push(d); days[f.away].push(d); }));
      let b2b = 0, gaps = 0;
      days.forEach((ds) => ds.forEach((d, i) => { if (i) { gaps++; if (d - ds[i - 1] === 1) b2b++; } }));
      const rate = b2b / Math.max(1, gaps);
      ok(rate > 0.02 && rate < 0.6, `back-to-backs happen but aren't the norm (${(rate * 100).toFixed(0)}%)`);
      const worstSplit = Math.max(...home.map((h) => Math.abs(h - len / 2)));
      ok(worstSplit <= len * 0.12, `home/away stays balanced (worst off by ${worstSplit})`);
      const dup = G.schedule.some((day) => {
        const seen = new Set();
        return day.some((f) => {
          if (seen.has(f.home) || seen.has(f.away)) return true;
          seen.add(f.home); seen.add(f.away); return false;
        });
      });
      ok(!dup, "no club is booked twice on one day");
    });
  },

  // A full season, then the arithmetic has to close.
  season(A) {
    section("Full-season invariants (41-game season)");
    const G = A.newGame(0, { seed: 21, rules: { seasonLen: 41 } });
    simSeason(A, G);
    ok(G.phase === "playoffs", `the season ended and the playoffs began (phase=${G.phase})`);

    const badGp = G.teams.filter((t) => t.gp !== 41);
    ok(badGp.length === 0, "every club played all 41",
      badGp.length ? `${badGp[0].abbr} played ${badGp[0].gp}` : "");
    const badRec = G.teams.filter((t) => t.w + t.l + t.otl !== t.gp);
    ok(badRec.length === 0, "W + L + OTL reconciles with games played");
    const badPts = G.teams.filter((t) => t.pts !== t.w * 2 + t.otl);
    ok(badPts.length === 0, "points = 2×W + OTL");

    const totalGf = G.teams.reduce((s, t) => s + t.gf, 0);
    const totalGa = G.teams.reduce((s, t) => s + t.ga, 0);
    ok(totalGf === totalGa, `league goals for equals goals against (${totalGf} vs ${totalGa})`);

    const gpg = totalGf / (G.teams.reduce((s, t) => s + t.gp, 0));
    // Bands are the real NHL numbers now that the engine is calibrated against
    // them, so a drift in shot rates or save percentage trips here.
    ok(gpg > 2.5 && gpg < 3.6, `goals per team-game matches the NHL (${gpg.toFixed(2)}, real ~3.1)`);
    const sogpg = A.playersOf(G).filter((p) => p.pos !== "G").reduce((s, p) => s + p.season.sog, 0)
      / G.teams.reduce((s, t) => s + t.gp, 0);
    ok(sogpg > 26 && sogpg < 35, `shots on goal per team-game matches the NHL (${sogpg.toFixed(1)}, real ~30.5)`);
    const shPct = totalGf / A.playersOf(G).filter((p) => p.pos !== "G").reduce((s, p) => s + p.season.sog, 0);
    ok(shPct > 0.085 && shPct < 0.112, `and so does shooting percentage (${(shPct * 100).toFixed(1)}%, real ~9.6%)`);

    // Player goals must add back up to team goals, once the shootout winner —
    // which no skater is credited with, exactly as in real bookkeeping — is
    // accounted for.
    const soWins = new Array(32).fill(0);
    G.results.forEach((r) => { if (r.so) soWins[r.hg > r.ag ? r.home : r.away]++; });
    // Per team, count the goals as they were actually scored — a player traded
    // at the deadline takes his season totals with him, so his current club is
    // not who he scored them for.
    const byTeam = new Array(32).fill(0);
    G.results.forEach((r) => r.scorers.forEach((s) => { byTeam[s.t]++; }));
    const mismatch = G.teams.filter((t) => byTeam[t.id] + soWins[t.id] !== t.gf);
    ok(mismatch.length === 0, "goals as scored + shootout winners reconcile with team goals",
      mismatch.length ? `${mismatch[0].abbr}: scored ${byTeam[mismatch[0].id]} + ${soWins[mismatch[0].id]} SO vs team ${mismatch[0].gf}` : "");
    // And league-wide, every skater goal is accounted for.
    const skaterGoals = A.playersOf(G).filter((p) => p.pos !== "G").reduce((s, p) => s + p.season.g, 0);
    const scoredGoals = G.results.reduce((s, r) => s + r.scorers.length, 0);
    ok(skaterGoals === scoredGoals, `every skater goal has a scoring record (${skaterGoals} vs ${scoredGoals})`);

    // Goalie shots faced should track the shots the other side actually took,
    // less the ones fired into an empty net.
    const totalEng = A.playersOf(G).filter((p) => p.pos !== "G").reduce((s, p) => s + (p.season.eng || 0), 0);
    const totalSa = A.playersOf(G).filter((p) => p.pos === "G").reduce((s, p) => s + p.season.sa, 0);
    const totalSog = A.playersOf(G).filter((p) => p.pos !== "G").reduce((s, p) => s + p.season.sog, 0);
    ok(totalSog === totalSa + totalEng,
      `every shot was faced by a goalie or hit an empty net (${totalSog} vs ${totalSa} + ${totalEng} EN)`);
    const totalGaG = A.playersOf(G).filter((p) => p.pos === "G").reduce((s, p) => s + p.season.ga, 0);
    const totalSo = soWins.reduce((a, b) => a + b, 0);
    ok(totalGaG + totalSo + totalEng === totalGf,
      `goals charged to goalies + SO + empty-netters matches league goals (${totalGaG}+${totalSo}+${totalEng} vs ${totalGf})`);
    ok(totalEng > 0 && totalEng / totalGf < 0.09,
      `empty-net goals are a small real slice (${totalEng}, ${(totalEng / totalGf * 100).toFixed(1)}%)`);

    // Nobody should be credited with a game they didn't dress for.
    const ghosts = A.playersOf(G).filter((p) => p.season.gp > 0 && p.season.toi <= 0);
    ok(ghosts.length === 0, "no player is credited with a game they never played",
      ghosts.length ? `${ghosts.length} players` : "");
    // A player traded mid-season can exceed his club's game count — that's real
    // — but not by much, and never by a whole extra season.
    const overplayed = A.playersOf(G).filter((p) => p.season.gp > 41 + 10);
    ok(overplayed.length === 0, "nobody plays a wildly impossible number of games",
      overplayed.length ? `${overplayed[0].ln} ${overplayed[0].season.gp}` : "");

    const leader = A.playersOf(G).filter((p) => p.pos !== "G")
      .sort((a, b) => A.pts(b.season) - A.pts(a.season))[0];
    const ppg = A.pts(leader.season) / leader.season.gp;
    ok(ppg > 0.7 && ppg < 2.6, `the scoring leader is human (${A.pts(leader.season)} in ${leader.season.gp}, ${ppg.toFixed(2)}/g)`);

    const gs = A.playersOf(G).filter((p) => p.pos === "G" && p.season.sa > 200);
    const sv = gs.reduce((s, p) => s + A.svPct(p.season), 0) / Math.max(1, gs.length);
    ok(sv > 0.893 && sv < 0.915, `league save percentage matches the NHL (${sv.toFixed(3)}, real ~.903)`);

    // Better clubs should finish higher than worse ones, on average.
    const rated = G.teams.map((t) => ({ s: A.teamStrength(G, t.id), p: t.pts }));
    const half = rated.slice().sort((a, b) => b.s - a.s);
    const topAvg = half.slice(0, 8).reduce((s, x) => s + x.p, 0) / 8;
    const botAvg = half.slice(-8).reduce((s, x) => s + x.p, 0) / 8;
    ok(topAvg > botAvg + 6, `roster quality shows up in the table (${topAvg.toFixed(0)} vs ${botAvg.toFixed(0)} pts)`);
  },

  // The loser point is the defining standings knob — it must actually change things.
  points(A) {
    section("Points system");
    [true, false].forEach((lp) => {
      const G = A.newGame(0, { seed: 33, rules: { seasonLen: 41, otLoserPoint: lp } });
      simSeason(A, G);
      const bad = G.teams.filter((t) => t.pts !== t.w * 2 + (lp ? t.otl : 0));
      ok(bad.length === 0, `otLoserPoint=${lp} → points math holds`,
        bad.length ? `${bad[0].abbr} ${bad[0].pts} pts on ${bad[0].w}W/${bad[0].otl}OTL` : "");
      if (!lp) {
        const otl = G.teams.reduce((s, t) => s + t.otl, 0);
        ok(otl === 0, "with no loser point, nothing lands in the OTL column", `got ${otl}`);
      }
    });
    // Ties: with overtime off, games are allowed to end level.
    const G = A.newGame(0, { seed: 34, rules: { seasonLen: 41, otFormat: "none" } });
    simSeason(A, G);
    const ties = G.results.filter((r) => r.hg === r.ag).length;
    ok(ties > 0, `otFormat=none produces real ties (${ties})`);
  },

  // Both playoff formats must produce a legal bracket and exactly one champion.
  playoffs(A) {
    section("Playoffs");
    ["divisional", "seeded"].forEach((fmt) => {
      const G = A.newGame(0, { seed: 44, rules: { seasonLen: 41, playoffFormat: fmt } });
      simSeason(A, G);
      const r1 = G.playoffs.rounds[0];
      ok(r1.length === 8, `${fmt} → eight first-round series (got ${r1.length})`);
      const teams = r1.flatMap((s) => [s.hi, s.lo]);
      ok(new Set(teams).size === 16, `${fmt} → sixteen distinct clubs qualify`);
      const perConf = [0, 1].map((c) => teams.filter((id) => G.teams[id].conf === c).length);
      ok(perConf[0] === 8 && perConf[1] === 8, `${fmt} → eight per conference (${perConf.join("/")})`);

      simPlayoffs(A, G);
      ok(G.playoffs.champion != null, `${fmt} → a champion emerged`);
      ok(G.phase === "offseason", `${fmt} → the season closed out (phase=${G.phase})`);
      const need = Math.ceil(A.ruleValue(G, "seriesLen") / 2);
      const badSeries = G.playoffs.rounds.flat().filter((s) => s.done && Math.max(...s.w) !== need);
      ok(badSeries.length === 0, `${fmt} → every series ended at ${need} wins`);
      ok(G.teams[G.playoffs.champion].cupWins === 1, `${fmt} → the Cup was recorded`);
    });

    // Best of five ends sooner than best of seven.
    const G5 = A.newGame(0, { seed: 45, rules: { seasonLen: 41, seriesLen: 5 } });
    simSeason(A, G5); simPlayoffs(A, G5);
    const longest = Math.max(...G5.playoffs.rounds.flat().map((s) => s.games.length));
    ok(longest <= 5, `best-of-5 never runs past five games (longest ${longest})`);
  },

  // The hard cap is the whole GM constraint — it has to hold through trades and FA.
  cap(A) {
    section("Salary cap");
    const G = A.newGame(3, { seed: 55 });
    const cap = A.rules(G).capAmount;
    ok(A.capHit(G, 3) <= cap, `user club fits under the cap ($${A.capHit(G, 3)}M of $${cap}M)`);

    // A trade that would break the cap must be refused.
    const rich = A.rosterOf(G, 3).sort((a, b) => b.contract.amt - a.contract.amt)[0];
    const other = 4;
    const theirBest = A.rosterOf(G, other).sort((a, b) => b.contract.amt - a.contract.amt);
    const load = [];
    let sum = 0;
    for (const p of theirBest) { load.push(p.id); sum += p.contract.amt; if (sum > A.capSpace(G, 3) + rich.contract.amt + 5) break; }
    const ev = A.evalTrade(G, 3, [rich.id], [], other, load, []);
    ok(!ev.ok, `a cap-busting trade is refused (${ev.why})`);

    // A one-for-one of similar value should be legal, whatever the AI thinks of it.
    const mine = A.rosterOf(G, 3).sort((a, b) => b.ovr - a.ovr)[6];
    const theirs = A.rosterOf(G, other).sort((a, b) => b.ovr - a.ovr)[6];
    const ev2 = A.evalTrade(G, 3, [mine.id], [], other, [theirs.id], []);
    ok(ev2.why !== "roster limit" && !/over the cap/.test(ev2.why || ""),
      `a like-for-like swap isn't blocked by the cap (${ev2.why})`);

    // Signing beyond the cap is refused outright.
    const fa = G.freeAgents.map((id) => G.players[id]).sort((a, b) => b.ovr - a.ovr)[0];
    const r = A.signPlayer(G, fa.id, 3, cap, 3);
    ok(!r.ok, `an over-cap signing is rejected (${r.why})`);
  },

  // Trades have to actually move players and picks, and stay symmetrical.
  trade(A) {
    section("Trades");
    const G = A.newGame(0, { seed: 66 });
    const a = A.rosterOf(G, 0).sort((x, y) => y.ovr - x.ovr)[4];
    const b = A.rosterOf(G, 1).sort((x, y) => y.ovr - x.ovr)[4];
    const beforeA = A.rosterOf(G, 0, true).length, beforeB = A.rosterOf(G, 1, true).length;
    const res = A.doTrade(G, 0, [a.id], [], 1, [b.id], []);
    if (res.ok) {
      ok(G.players[a.id].teamId === 1, "the outgoing player changed hands");
      ok(G.players[b.id].teamId === 0, "the incoming player changed hands");
      ok(A.rosterOf(G, 0, true).length === beforeA && A.rosterOf(G, 1, true).length === beforeB,
        "roster sizes stayed level in a one-for-one");
    } else {
      ok(true, `the AI declined a one-for-one, which is allowed (${res.why})`);
    }
    // A player who isn't on the roster can never be traded.
    const bogus = A.rosterOf(G, 7)[0];
    const bad = A.evalTrade(G, 0, [bogus.id], [], 1, [], []);
    ok(!bad.ok, `you can't trade another club's player (${bad.why})`);
    // The lineup rebuilds after a trade rather than pointing at a departed player.
    const lines = A.ensureLines(G, 0);
    const ids = new Set(A.activeRoster(G, 0).map((p) => p.id));
    const dangling = lines.F.flat().concat(lines.D.flat(), lines.G).filter((id) => id != null && !ids.has(id));
    ok(dangling.length === 0, "no line slot points at a player who left");
  },

  // The rollover: ageing, contracts, the draft, and a league that can play again.
  rollover(A) {
    section("Season rollover");
    const G = A.newGame(0, { seed: 77, rules: { seasonLen: 41 } });
    simSeason(A, G); simPlayoffs(A, G);

    ok(G.draftClass.length === 64, `a draft class was generated (${G.draftClass.length})`);
    ok(G.draftOrder.length === 32, "every club has a draft slot");
    const nonPlayoff = G.teams.filter((t) => !A.inPlayoffs(G, t.id)).length;
    ok(nonPlayoff === 16, `sixteen clubs missed the playoffs (${nonPlayoff})`);
    const firstTen = G.draftOrder.slice(0, 10);
    ok(firstTen.every((id) => !A.inPlayoffs(G, id)), "the lottery only draws from non-playoff clubs");

    A.autoDraft(G, false);
    ok(G.draftClass.length <= 0 || G.draftPick === 64, `the draft completed (${G.draftPick} picks made)`);
    const drafted = A.playersOf(G).filter((p) => p.rookie && p.teamId != null);
    ok(drafted.length >= 60, `prospects landed on clubs (${drafted.length})`);
    ok(drafted.every((p) => p.farm), "draftees start on the farm");

    const oldAges = A.playersOf(G).filter((p) => p.teamId != null).map((p) => p.age);
    const beforeYear = G.year;
    A.aiFreeAgency(G);
    A.startNextSeason(G);

    ok(G.year === beforeYear + 1, `the calendar advanced (${beforeYear} → ${G.year})`);
    ok(G.phase === "regular", `back to a regular season (phase=${G.phase})`);
    ok(G.teams.every((t) => t.gp === 0 && t.pts === 0), "the table was wiped");
    ok(G.results.length === 0, "last season's results were cleared");
    ok(gamesPerTeam(G).every((c) => c === 41), "a new 41-game schedule was built");
    const newAges = A.playersOf(G).filter((p) => p.teamId != null).map((p) => p.age);
    ok(Math.min(...newAges) >= Math.min(...oldAges), "everyone got a year older");
    ok(A.playersOf(G).some((p) => p.career.length > 0), "last season became career history");
    ok(G.teams.every((t) => A.rosterOf(G, t.id).length >= 18),
      "every club can still dress a roster after the rollover",
      G.teams.filter((t) => A.rosterOf(G, t.id).length < 18).map((t) => `${t.abbr}:${A.rosterOf(G, t.id).length}`).join(" "));
    ok(G.teams.every((t) => A.rosterOf(G, t.id).filter((p) => p.pos === "G").length >= 2),
      "every club still has two goaltenders");

    // And the new season must actually be playable.
    simSeason(A, G);
    ok(G.teams.every((t) => t.gp === 41), "the second season plays to completion");
  },

  // Structural knobs stage for the rollover; the rest apply immediately.
  ruleStaging(A) {
    section("Rule staging");
    const G = A.newGame(0, { seed: 88, rules: { seasonLen: 41 } });
    A.setRule(G, "injuries", "high");
    ok(A.rules(G).injuries === "high", "a non-structural knob applies at once");
    A.setRule(G, "seasonLen", 56);
    ok(A.rules(G).seasonLen === 41, "a structural knob does NOT change the season in progress");
    ok(A.ruleValue(G, "seasonLen") === 56, "but the UI reads the staged value");
    ok(gamesPerTeam(G).every((c) => c === 41), "the live schedule is untouched");
    simSeason(A, G); simPlayoffs(A, G);
    A.autoDraft(G, false); A.aiFreeAgency(G); A.startNextSeason(G);
    ok(A.rules(G).seasonLen === 56, "the staged knob promoted at the rollover");
    ok(gamesPerTeam(G).every((c) => c === 56), "the new schedule uses it");
    ok(!G.pendingRules || !Object.keys(G.pendingRules).length, "nothing is left staged");
  },

  // Lines drive the engine, so a broken lineup is a broken game.
  lines(A) {
    section("Lines and matchups");
    const G = A.newGame(0, { seed: 99 });
    const L = A.ensureLines(G, 0);
    ok(L.F.length === 4 && L.F.every((l) => l.length === 3), "four forward lines of three");
    ok(L.D.length === 3 && L.D.every((p) => p.length === 2), "three defence pairs");
    ok(L.G.length === 2 && L.G[0] != null, "a starter and a backup");
    const all = L.F.flat().concat(L.D.flat(), L.G).filter((x) => x != null);
    ok(new Set(all).size === all.length, "nobody is double-shifted into two slots");
    ok(L.D.flat().every((id) => G.players[id].pos === "D"), "only defencemen play defence");
    ok(L.G.every((id) => id == null || G.players[id].pos === "G"), "only goalies play goal");

    // Ice time should follow the depth chart.
    A.simDays(G, 20);
    const toiOf = (id) => (G.players[id] ? G.players[id].season.toi : 0);
    const gp = G.players[L.F[0][0]].season.gp || 1;
    const l1 = L.F[0].reduce((s, id) => s + toiOf(id), 0) / 3 / gp;
    const l4 = L.F[3].reduce((s, id) => s + toiOf(id), 0) / 3 / Math.max(1, G.players[L.F[3][0]].season.gp);
    ok(l1 > l4, `the first line outplays the fourth (${l1.toFixed(1)} vs ${l4.toFixed(1)} min/g)`);
    // Ice time is per player, not split between linemates — a first-liner plays
    // most of a period and a half, not five minutes.
    ok(l1 > 13 && l1 < 26, `a first-liner's night is a real one (${l1.toFixed(1)} min)`);
    ok(l4 > 4 && l4 < 14, `and the fourth line gets a fourth-line shift (${l4.toFixed(1)} min)`);
    const d1 = L.D[0].reduce((s, id) => s + toiOf(id), 0) / 2 / Math.max(1, G.players[L.D[0][0]].season.gp);
    ok(d1 > 15 && d1 < 30, `the top pair carries the biggest load (${d1.toFixed(1)} min)`);
    const gTOI = toiOf(L.G[0]) / Math.max(1, G.players[L.G[0]].season.gp);
    ok(Math.abs(gTOI - 60) < 0.5, `a goalie who starts plays the full sixty (${gTOI.toFixed(1)})`);

    // Line chemistry: keeping a line intact builds a streak that caps out,
    // and touching the line resets it back to zero on the next game.
    const t0 = G.teams[0];
    ok(t0.lineChem[0] > 0, `an intact top line has built chemistry (${t0.lineChem[0]} games)`);
    ok(t0.lineChem.every((g) => g <= A.LINE_CHEM_MAX_GAMES), "chemistry caps out rather than growing forever");
    A.simDays(G, 60);
    ok(t0.lineChem[0] === A.LINE_CHEM_MAX_GAMES, `a line left alone for a season hits the cap (${t0.lineChem[0]})`);
    const tmp = t0.lines.F[0][0];
    t0.lines.F[0][0] = t0.lines.F[1][0];
    t0.lines.F[1][0] = tmp;
    A.simDays(G, 10);
    ok(t0.lineChem[0] < A.LINE_CHEM_MAX_GAMES, `swapping the top line resets its chemistry streak (now ${t0.lineChem[0]})`);

    // An injury must not leave a hole in the lineup.
    const victim = G.players[L.F[0][1]];
    victim.inj = 10;
    G.teams[0].lines = null;
    const L2 = A.ensureLines(G, 0);
    const stillIn = L2.F.flat().includes(victim.id);
    ok(!stillIn, "an injured player is pulled out of the lineup");
    A.simDays(G, 3);
    ok(true, "the club keeps playing a man down");
  },

  // Special teams have to show up in the box score.
  specialTeams(A) {
    section("Special teams");
    const G = A.newGame(0, { seed: 101, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const totalPim = A.playersOf(G).reduce((s, p) => s + (p.season.pim || 0), 0);
    ok(totalPim > 0, `penalties were taken (${totalPim} PIM)`);
    const ppg = A.playersOf(G).reduce((s, p) => s + (p.season.ppg || 0), 0);
    const total = G.teams.reduce((s, t) => s + t.gf, 0);
    const share = ppg / total;
    ok(share > 0.1 && share < 0.4, `power-play goals are a believable share (${(share * 100).toFixed(0)}%)`);
    const fow = A.playersOf(G).reduce((s, p) => s + (p.season.fow || 0), 0);
    const fol = A.playersOf(G).reduce((s, p) => s + (p.season.fol || 0), 0);
    ok(fow > 0 && fol > 0, `faceoffs were taken (${fow} won / ${fol} lost)`);
  },

  // Injuries should bite without emptying the league.
  injuries(A) {
    section("Injuries");
    const counts = {};
    ["low", "normal", "high"].forEach((level) => {
      const G = A.newGame(0, { seed: 111, rules: { seasonLen: 41, injuries: level } });
      let injured = 0;
      const seen = new Set();
      for (let i = 0; i < 41; i++) {
        A.simDay(G);
        A.playersOf(G).forEach((p) => { if (p.inj > 0 && !seen.has(p.id)) { seen.add(p.id); injured++; } });
      }
      counts[level] = injured;
      ok(injured > 0, `${level}: players got hurt (${injured} over the season)`);
      const wiped = G.teams.filter((t) => A.activeRoster(G, t.id).length < 14);
      ok(wiped.length === 0, `${level}: no club was wiped out`, wiped.length ? `${wiped.length} clubs` : "");
    });
    ok(counts.high > counts.low, `the setting matters (low ${counts.low} → high ${counts.high})`);
  },

  // Awards should go to players who earned them.
  awards(A) {
    section("Awards");
    const G = A.newGame(0, { seed: 121, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const AW = G.awards;
    ok(AW && AW.mvp != null, "an MVP was named");
    const top = A.playersOf(G).filter((p) => p.pos !== "G")
      .sort((a, b) => A.pts(b.season) - A.pts(a.season))[0];
    ok(AW.scoring === top.id, "the scoring trophy went to the points leader");
    const topG = A.playersOf(G).filter((p) => p.pos === "G" && p.season.gp > 15)
      .sort((a, b) => A.svPct(b.season) - A.svPct(a.season))[0];
    ok(AW.goalie === topG.id, "the goaltending trophy went to the best save percentage");
    ok(G.players[AW.mvp].trophies.length > 0, "the trophy was recorded on the player");
  },

  // Two goalies, a real workload split, and a shootout that is a contest.
  goaltending(A) {
    section("Goaltending");
    const G = A.newGame(0, { seed: 141, rules: { seasonLen: 82 } });
    simSeason(A, G);
    const splits = G.teams.map((t) => {
      const gs = A.rosterOf(G, t.id).filter((p) => p.pos === "G")
        .sort((a, b) => b.season.gp - a.season.gp);
      return gs.length >= 2 ? { t, s: gs[0].season.gp, b: gs[1].season.gp } : null;
    }).filter(Boolean);
    ok(splits.length >= 30, `clubs carry two goalies all season (${splits.length})`);
    const benched = splits.filter((x) => x.b === 0);
    ok(benched.length === 0, "every backup got starts", benched.length ? `${benched.length} never played` : "");
    const ironman = splits.filter((x) => x.s > 74);
    ok(ironman.length === 0, "nobody starts nearly every night",
      ironman.length ? `${ironman[0].t.abbr} started ${ironman[0].s}` : "");
    const avgStarter = splits.reduce((s, x) => s + x.s, 0) / splits.length;
    ok(avgStarter > 38 && avgStarter < 70, `the starter still carries it (${avgStarter.toFixed(0)} of 82)`);

    const soa = A.playersOf(G).reduce((s, p) => s + (p.season.soa || 0), 0);
    const sos = A.playersOf(G).reduce((s, p) => s + (p.season.sos || 0), 0);
    ok(soa > 0, `shootout attempts were taken (${soa})`);
    ok(sos > 0 && sos < soa, `shootout attempts are stoppable (${sos} of ${soa})`);
    const gsosa = A.playersOf(G).filter((p) => p.pos === "G").reduce((s, p) => s + (p.season.sosa || 0), 0);
    ok(gsosa === soa, `every shootout attempt faced a goalie (${gsosa} vs ${soa})`);
    const sow = A.playersOf(G).filter((p) => p.pos === "G").reduce((s, p) => s + (p.season.sow || 0), 0);
    const sol = A.playersOf(G).filter((p) => p.pos === "G").reduce((s, p) => s + (p.season.sol || 0), 0);
    ok(sow > 0 && sow === sol, `shootout decisions balance (${sow}W / ${sol}L)`);
    // Shootout goals are never season goals.
    const soScorers = A.playersOf(G).filter((p) => (p.season.sos || 0) > 0);
    ok(soScorers.length > 0, `shootout scorers are tracked separately (${soScorers.length})`);
  },

  // The per-zone shot breakdown has to add back up to the totals, from both
  // sides of the puck.
  zones(A) {
    section("Shot breakdown by zone");
    const G = A.newGame(0, { seed: 161, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const Z = ["rush", "cycle", "point"];
    const skaters = A.playersOf(G).filter((p) => p.pos !== "G" && p.season.sog > 0);
    const badS = skaters.filter((p) => {
      const zs = Z.reduce((s, k) => s + p.season.z[k].s, 0);
      return zs + (p.season.eng || 0) !== p.season.sog;
    });
    ok(badS.length === 0, "a skater's zone shots plus empty-netters equal his shots on goal",
      badS.length ? `${badS[0].ln}: ${Z.map((k) => badS[0].season.z[k].s).join("+")} vs ${badS[0].season.sog}` : "");
    const badSg = skaters.filter((p) => Z.reduce((s, k) => s + p.season.z[k].g, 0) + (p.season.eng || 0) !== p.season.g);
    ok(badSg.length === 0, "and his zone goals equal his goals");

    const goalies = A.playersOf(G).filter((p) => p.pos === "G" && p.season.sa > 0);
    const badG = goalies.filter((p) => Z.reduce((s, k) => s + p.season.z[k].sa, 0) !== p.season.sa);
    ok(badG.length === 0, "a goalie's zone shots faced equal his shots against");
    const badGv = goalies.filter((p) => Z.reduce((s, k) => s + p.season.z[k].sv, 0) !== p.season.sv);
    ok(badGv.length === 0, "and his zone saves equal his saves");

    // Both sides must agree on what the league's zone mix looks like.
    const sSum = Z.map((k) => skaters.reduce((s, p) => s + p.season.z[k].s, 0));
    const gSum = Z.map((k) => goalies.reduce((s, p) => s + p.season.z[k].sa, 0));
    ok(Z.every((_, i) => sSum[i] === gSum[i]),
      `shooters and goalies agree zone by zone (${sSum.join("/")})`);
    const total = sSum.reduce((a, b) => a + b, 0);
    ok(sSum.every((n) => n / total > 0.1), `every zone gets real volume (${sSum.map((n) => (n / total * 100).toFixed(0) + "%").join(" ")})`);
    // And the danger ordering has to hold: rush beats cycle beats point.
    const pct = Z.map((k) => {
      const s = skaters.reduce((a, p) => a + p.season.z[k].s, 0);
      const g = skaters.reduce((a, p) => a + p.season.z[k].g, 0);
      return g / s;
    });
    ok(pct[0] > pct[1] && pct[1] > pct[2],
      `rush > cycle > point on conversion (${pct.map((x) => (x * 100).toFixed(1)).join(" / ")}%)`);
  },

  // Where the puck ended up: on goal, wide, or blocked — and whereabouts in the
  // net when it got there.
  placement(A) {
    section("Shot attempts and net placement");
    const G = A.newGame(0, { seed: 163, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const K = A.NET_KEYS;
    const skaters = A.playersOf(G).filter((p) => p.pos !== "G" && p.season.att > 0);

    // Every attempt ends up in exactly one of three places.
    const badAtt = skaters.filter((p) => p.season.sog + p.season.miss + p.season.blkd !== p.season.att);
    ok(badAtt.length === 0, "attempts split cleanly into on goal, missed and blocked",
      badAtt.length ? `${badAtt[0].ln}: ${badAtt[0].season.sog}+${badAtt[0].season.miss}+${badAtt[0].season.blkd} vs ${badAtt[0].season.att}` : "");
    const att = skaters.reduce((s, p) => s + p.season.att, 0);
    const on = skaters.reduce((s, p) => s + p.season.sog, 0);
    const share = on / att;
    ok(share > 0.44 && share < 0.66, `about half of attempts reach the net (${(share * 100).toFixed(0)}%)`);
    const blocked = skaters.reduce((s, p) => s + p.season.blkd, 0);
    // Over EVERY skater, not just the ones who shot — a stay-at-home defenceman
    // blocks plenty and may not have taken an attempt all year.
    const allSkaters = A.playersOf(G).filter((p) => p.pos !== "G");
    const blocks = allSkaters.reduce((s, p) => s + p.season.blk, 0);
    ok(blocked === blocks, `every blocked shot was blocked by somebody (${blocked} vs ${blocks})`);
    const dBlocks = allSkaters.filter((p) => p.pos === "D").reduce((s, p) => s + p.season.blk, 0);
    ok(dBlocks / blocks > 0.9, `defencemen do the blocking (${(dBlocks / blocks * 100).toFixed(0)}%)`);

    // Placement has to reconcile with shots on goal, less empty-netters.
    const badNet = skaters.filter((p) => K.reduce((s, k) => s + p.season.net[k].a, 0) !== p.season.sog - (p.season.eng || 0));
    ok(badNet.length === 0, "a skater's net placements equal his shots on goal, less empty-netters",
      badNet.length ? `${badNet[0].ln}` : "");
    const badNetG = skaters.filter((p) => K.reduce((s, k) => s + p.season.net[k].g, 0) !== p.season.g - (p.season.eng || 0));
    ok(badNetG.length === 0, "and his placed goals equal his goals, less empty-netters");

    const goalies = A.playersOf(G).filter((p) => p.pos === "G" && p.season.sa > 0);
    const badGa = goalies.filter((p) => K.reduce((s, k) => s + p.season.net[k].sa, 0) !== p.season.sa);
    ok(badGa.length === 0, "a goalie's placements equal the shots he faced");
    const badGg = goalies.filter((p) => K.reduce((s, k) => s + p.season.net[k].ga, 0) !== p.season.ga);
    ok(badGg.length === 0, "and the goals he allowed");

    /* Calibrated against public NHL shot-target work. The whole point is that
       shots and goals pull in opposite directions: most shots are low, most
       goals are high. If a change to shot rates drags these out of band the
       chart stops meaning anything, so they're pinned here. */
    const netShare = (keys, field) => {
      const tot = K.reduce((s, k) => s + skaters.reduce((a, p) => a + p.season.net[k][field], 0), 0);
      const part = keys.reduce((s, k) => s + skaters.reduce((a, p) => a + p.season.net[k][field], 0), 0);
      return tot ? part / tot : 0;
    };
    const HIGH = ["GH", "MH", "BH"], MID = ["GM", "MM", "BM"], LOW = ["GL", "FH", "BL"];
    const abovePads = netShare(HIGH, "g") + netShare(MID, "g");
    ok(abovePads > 0.60 && abovePads < 0.74,
      `about two thirds of goals go in above the pads (${(abovePads * 100).toFixed(0)}%, NHL ~67%)`);
    ok(netShare(LOW, "a") > netShare(HIGH, "a") * 1.8,
      `but most shots are aimed low (${(netShare(LOW, "a") * 100).toFixed(0)}% low vs ${(netShare(HIGH, "a") * 100).toFixed(0)}% high)`);
    const gh = netShare(["GH"], "g"), bh = netShare(["BH"], "g"), fh = netShare(["FH"], "g");
    ok(gh > 0.16 && gh < 0.26, `top glove is the biggest single source of goals (${(gh * 100).toFixed(0)}%, NHL ~21%)`);
    ok(bh > 0.11 && bh < 0.19, `high blocker sits behind it (${(bh * 100).toFixed(0)}%, NHL ~15%)`);
    ok(gh > bh, "and goalies concede more glove side than blocker side, as they really do");
    ok(fh > 0.10 && fh < 0.19, `the five-hole is worth about a seventh of goals (${(fh * 100).toFixed(0)}%, NHL ~14%)`);
    const best = K.slice().sort((a, b) =>
      skaters.reduce((s, p) => s + p.season.net[b].g, 0) - skaters.reduce((s, p) => s + p.season.net[a].g, 0))[0];
    ok(best === "GH", `top glove is the single most-scored-on cell (got ${best})`);

    // Individuality: two wingers should not have the same chart.
    const spots = new Set(A.playersOf(G).filter((p) => p.pos !== "G").slice(0, 60).map((p) => A.shooterSpot(p).key));
    ok(spots.size >= 6, `shooters favour different corners (${spots.size} distinct)`);
    const lefties = A.playersOf(G).filter((p) => p.pos !== "G");
    const lShare = lefties.filter((p) => p.shoots === "L").length / lefties.length;
    ok(lShare > 0.5 && lShare < 0.75, `the league shoots mostly left-handed (${(lShare * 100).toFixed(0)}%, NHL ~62%)`);

    // Corners beat centre mass — that's the whole point of the chart.
    const cellRate = (k) => {
      const a = skaters.reduce((s, p) => s + p.season.net[k].a, 0);
      const g = skaters.reduce((s, p) => s + p.season.net[k].g, 0);
      return a ? g / a : 0;
    };
    const corners = A.NET_CELLS.filter((c) => c.corner).map((c) => cellRate(c.key));
    const worstCorner = Math.min(...corners);
    ok(worstCorner > cellRate("MM"),
      `every corner beats centre mass (worst corner ${(worstCorner * 100).toFixed(1)}% vs ${(cellRate("MM") * 100).toFixed(1)}%)`);
    const spread = K.map((k) => skaters.reduce((s, p) => s + p.season.net[k].a, 0));
    ok(spread.every((n) => n > 0), "every cell in the net gets shot at");
    ok(Math.max(...spread) / Math.min(...spread) < 12, "and no single cell swallows everything");

    // A goalie's weak spot is fixed for his career, so scouting him means something.
    const g0 = goalies[0];
    ok(A.goalieHole(g0).key === A.goalieHole(g0).key, "a goalie's hole is stable");
    const holes = new Set(goalies.slice(0, 40).map((p) => A.goalieHole(p).key));
    ok(holes.size >= 5, `goalies don't all share the same weakness (${holes.size} distinct)`);

    // The per-shot log: real records, the user's club only, and it has to agree
    // with the season totals it was built alongside.
    section("Shot and game logs");
    const mine = A.rosterOf(G, G.userTeam).filter((p) => p.pos !== "G" && p.season.att > 0);
    ok(mine.length > 0, "the user's skaters have attempts");
    const logged = mine.filter((p) => (G.shotLog[p.id] || []).length > 0);
    ok(logged.length === mine.length, `every one of them has a shot log (${logged.length}/${mine.length})`);
    const other = A.rosterOf(G, (G.userTeam + 1) % 32).filter((p) => p.pos !== "G");
    ok(other.every((p) => !(G.shotLog[p.id] || []).length),
      "and nobody outside the club is logged — that's what keeps the save small");

    const sample = logged.sort((a, b) => b.season.att - a.season.att)[0];
    const log = G.shotLog[sample.id];
    const capped = sample.season.att > 1400;
    ok(capped || log.length === sample.season.att,
      `the log holds every attempt (${log.length} vs ${sample.season.att})`);
    const byR = { g: 0, s: 0, m: 0, b: 0, e: 0 };
    log.forEach((r) => { byR[r.r]++; });
    if (!capped) {
      ok(byR.e === (sample.season.eng || 0), `logged empty-netters match (${byR.e})`);
      ok(byR.g === sample.season.g - (sample.season.eng || 0), `logged goals match (${byR.g})`);
      ok(byR.m === sample.season.miss, `logged misses match (${byR.m})`);
      ok(byR.b === sample.season.blkd, `logged blocks match (${byR.b})`);
      ok(byR.g + byR.s === sample.season.sog - (sample.season.eng || 0), "logged on-goal shots match");
    } else ok(true, "log was capped, totals not compared");
    ok(log.every((r) => r.d >= 0 && r.t >= 0 && r.t < 70), "every record carries a day and a clock time");
    ok(log.every((r) => r.o != null && r.o !== G.userTeam), "and an opponent that isn't us");
    ok(log.every((r) => (r.r === "g" || r.r === "s") ? !!r.c : r.c == null),
      "shots that reached the net have a placement; the others don't");

    // A goalie's log is the shots he faced.
    const gk = A.rosterOf(G, G.userTeam).filter((p) => p.pos === "G" && p.season.sa > 0)
      .sort((a, b) => b.season.sa - a.season.sa)[0];
    const glog = G.shotLog[gk.id] || [];
    ok(glog.length > 0, `the goalie has a log too (${glog.length})`);
    ok(glog.every((r) => r.c), "and it only holds shots that got to him");
    if (glog.length < 1400) {
      ok(glog.filter((r) => r.r === "g").length === gk.season.ga, "the goals in it match his goals against");
    } else ok(true, "goalie log capped");

    // The game log.
    const gl = G.gameLog[sample.id] || [];
    ok(gl.length === sample.season.gp || gl.length === 220,
      `the game log has a row per game (${gl.length} vs ${sample.season.gp})`);
    ok(gl.reduce((s, r) => s + r.g, 0) === sample.season.g || gl.length === 220,
      "and its goals add up to his season");
    ok(gl.every((r) => r.o != null && r.toi >= 0), "every row names an opponent and an ice time");

    // Neither log may survive the rollover.
    simPlayoffs(A, G);
    A.autoDraft(G, false); A.startNextSeason(G);
    ok(Object.keys(G.shotLog).length === 0 && Object.keys(G.gameLog).length === 0,
      "both logs are cleared at the rollover");
  },

  // Shot zones and fighting: flavour that has to show up in the numbers.
  flavour(A) {
    section("Shot quality and fighting");
    const G = A.newGame(0, { seed: 151, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const ds = A.playersOf(G).filter((p) => p.pos === "D" && p.season.sog > 20);
    const fs = A.playersOf(G).filter((p) => p.pos !== "D" && p.pos !== "G" && p.season.sog > 20);
    const dPct = ds.reduce((s, p) => s + p.season.g, 0) / ds.reduce((s, p) => s + p.season.sog, 0);
    const fPct = fs.reduce((s, p) => s + p.season.g, 0) / fs.reduce((s, p) => s + p.season.sog, 0);
    ok(dPct < fPct * 0.8,
      `point shots convert worse than forward chances (${(dPct * 100).toFixed(1)}% vs ${(fPct * 100).toFixed(1)}%)`);
    ok(dPct > 0.015, `defencemen still score (${(dPct * 100).toFixed(1)}%)`);
    const dShare = ds.reduce((s, p) => s + p.season.sog, 0) /
      (ds.reduce((s, p) => s + p.season.sog, 0) + fs.reduce((s, p) => s + p.season.sog, 0));
    ok(dShare > 0.18 && dShare < 0.45, `defencemen take a real share of the shots (${(dShare * 100).toFixed(0)}%)`);

    const fights = A.playersOf(G).reduce((s, p) => s + (p.season.fights || 0), 0);
    ok(fights > 0, `fights happened (${fights})`);
    const fighters = A.playersOf(G).filter((p) => (p.season.fights || 0) > 0);
    const skaters = A.playersOf(G).filter((p) => p.pos !== "G");
    const avgPhy = fighters.reduce((s, p) => s + p.r.phy, 0) / Math.max(1, fighters.length);
    const leaguePhy = skaters.reduce((s, p) => s + p.r.phy, 0) / skaters.length;
    ok(avgPhy > leaguePhy, `the heavies do the fighting (${avgPhy.toFixed(0)} vs league ${leaguePhy.toFixed(0)})`);
    const G2 = A.newGame(0, { seed: 151, rules: { seasonLen: 41, fighting: false } });
    simSeason(A, G2);
    ok(A.playersOf(G2).reduce((s, p) => s + (p.season.fights || 0), 0) === 0,
      "the fighting knob turns them off");
  },

  // Retained salary: the seller keeps paying, and it has to show on both books.
  retention(A) {
    section("Retained salary");
    const G = A.newGame(0, { seed: 171 });
    const star = A.rosterOf(G, 5).sort((a, b) => b.contract.amt - a.contract.amt)[0];
    star.ntc = false;
    const beforeSeller = A.capHit(G, 5), beforeBuyer = A.capHit(G, 6);
    const half = Math.round(star.contract.amt * 0.5 * 10) / 10;
    A.doTrade(G, 5, [star.id], [], 6, [], [], { retain: { [star.id]: 0.5 } });
    ok(G.players[star.id].teamId === 6, "the player moved");
    ok(A.retainedBy(G, 5).length === 1, "the seller carries a retained contract");
    ok(A.effectiveCap(G, G.players[star.id]) === Math.round((star.contract.amt - half) * 10) / 10,
      `the buyer only pays the balance ($${A.effectiveCap(G, G.players[star.id])}M of $${star.contract.amt}M)`);
    const sellerNow = A.capHit(G, 5), buyerNow = A.capHit(G, 6);
    ok(Math.abs(sellerNow - (beforeSeller - star.contract.amt + half)) < 0.15,
      `the seller still pays its half (${beforeSeller} → ${sellerNow})`);
    ok(Math.abs(buyerNow - (beforeBuyer + star.contract.amt - half)) < 0.15,
      `the buyer takes on the rest (${beforeBuyer} → ${buyerNow})`);

    // Only so many at once.
    let banked = 1, blocked = false;
    for (const p of A.rosterOf(G, 5).sort((a, b) => b.contract.amt - a.contract.amt).slice(0, 5)) {
      p.ntc = false;
      const ev = A.evalTrade(G, 5, [p.id], [], 7, [], [], { retain: { [p.id]: 0.5 } });
      if (/can only retain/.test(ev.why || "")) { blocked = true; break; }
      if (A.doTrade(G, 5, [p.id], [], 7, [], [], { retain: { [p.id]: 0.5 } }).ok) banked++;
    }
    ok(blocked || banked <= A.MAX_RETAINED, `a club can't retain more than ${A.MAX_RETAINED} contracts (${banked})`);

    // The knob turns it off entirely.
    const G2 = A.newGame(0, { seed: 172, rules: { retainedSalary: false } });
    const s2 = A.rosterOf(G2, 5).sort((a, b) => b.contract.amt - a.contract.amt)[0];
    s2.ntc = false;
    A.doTrade(G2, 5, [s2.id], [], 6, [], [], { retain: { [s2.id]: 0.5 } });
    ok(A.retainedBy(G2, 5).length === 0, "with the knob off, nothing is retained");
  },

  // No-trade clauses, waivers, negotiation, the deadline.
  gmDepth(A) {
    section("No-trade clauses, waivers and negotiation");
    const G = A.newGame(0, { seed: 181, rules: { seasonLen: 41 } });

    const locked = A.playersOf(G).filter((p) => A.hasNtc(p));
    ok(locked.length > 0, `stars negotiate no-trade clauses (${locked.length} in the league)`);
    ok(locked.every((p) => p.ovr >= 76 && p.age >= 26), "only established players get one");
    const mine = locked.find((p) => p.teamId != null);
    const ev = A.evalTrade(G, mine.teamId, [mine.id], [], (mine.teamId + 1) % 32, [], []);
    ok(!ev.ok && /no-trade/.test(ev.why), `a clause blocks the trade (${ev.why})`);
    let waived = false;
    for (let i = 0; i < 40 && !waived; i++) waived = A.requestNtcWaiver(G, mine.id).ok;
    ok(waived, "a clause can eventually be waived");
    const ev2 = A.evalTrade(G, mine.teamId, [mine.id], [], (mine.teamId + 1) % 32, [], []);
    ok(!/no-trade/.test(ev2.why || ""), "and then the trade is allowed to be judged on its merits");

    section("Waivers");
    const kid = A.rosterOf(G, 0).find((p) => p.age < 22);
    if (kid) {
      const r = A.sendDown(G, kid.id);
      ok(r.ok && !r.waivers, "a young player goes down without waivers");
    } else ok(true, "no waiver-exempt youngster on this roster to test");
    const vet = A.rosterOf(G, 0).find((p) => p.age >= 24 && !p.farm);
    vet.career = [{ gp: 200 }];
    ok(A.needsWaivers(G, vet), "an established player needs waivers");
    const r2 = A.sendDown(G, vet.id);
    ok(r2.ok && r2.waivers, "sending him down puts him on waivers instead");
    ok(vet.farm === false, "and he stays on the roster until they clear");
    G.day++;
    A.processWaivers(G);
    ok(vet.farm === true || vet.teamId !== 0, "after a day he either clears or is claimed");
    ok(G.waivers.length === 0, "the wire is emptied once processed");

    section("Contract negotiation");
    const fa = G.freeAgents.map((id) => G.players[id]).sort((a, b) => b.ovr - a.ovr)[0];
    const want = A.askingPrice(G, fa.id, 0, 3);
    ok(want > 0, `a free agent has a number ($${want}M × 3)`);
    ok(A.negotiate(G, fa.id, 0, want, 3).ok, "meeting it gets a signature");
    const low = A.negotiate(G, fa.id, 0, want * 0.9, 3);
    ok(!low.ok && low.counter, `a near miss gets a counter ($${low.counter}M)`);
    ok(!A.negotiate(G, fa.id, 0, want * 0.4, 3).ok, "a lowball gets nothing");
    const short = A.askingPrice(G, fa.id, 0, 1), long = A.askingPrice(G, fa.id, 0, 5);
    ok(short > long, `a one-year deal costs more per year than a five ($${short}M vs $${long}M)`);

    section("Trade deadline");
    const G3 = A.newGame(0, { seed: 182, rules: { seasonLen: 41 } });
    ok(A.tradesOpen(G3), "trades are open early in the season");
    const dl = A.deadlineDay(G3);
    ok(dl > 0 && dl < G3.schedule.length, `the deadline lands inside the season (day ${dl} of ${G3.schedule.length})`);
    const picksBefore = JSON.stringify(G3.picks);
    let guard = 0;
    while (G3.phase === "regular" && G3.day <= dl && guard++ < 400) A.simDay(G3);
    ok(!A.tradesOpen(G3), "and they shut once it passes");
    const after = A.evalTrade(G3, 0, [A.rosterOf(G3, 0)[0].id], [], 1, [], []);
    ok(!after.ok && /deadline/.test(after.why), `a post-deadline trade is refused (${after.why})`);
    ok(JSON.stringify(G3.picks) !== picksBefore, "the AI actually made deadline moves");

    section("Prospects");
    const G4 = A.newGame(0, { seed: 183, rules: { seasonLen: 41 } });
    let g2 = 0; while (G4.phase === "regular" && g2++ < 400) A.simDay(G4);
    const farmed = A.playersOf(G4).filter((p) => p.farm && p.farmSeason && p.farmSeason.gp > 0);
    ok(farmed.length > 0, `farm players played a season (${farmed.length})`);
    ok(farmed.some((p) => p.farmSeason.g > 0), "and produced");
    const youngFarm = A.playersOf(G4).filter((p) => p.farm && p.age <= 22).map((p) => p.ovr);
    let g3 = 0; while (G4.phase === "playoffs" && g3++ < 12) A.simPlayoffRound(G4);
    const grown = A.playersOf(G4).filter((p) => p.farm && p.age <= 23 && p.farmCareer);
    ok(grown.length > 0, "farm seasons are archived at the rollover");
    ok(A.playersOf(G4).some((p) => A.prospectReady(G4, p)), "some prospects are ready for a call-up");
  },

  // The record book, the break, the play-by-play, and franchise history.
  atmosphere(A) {
    section("Records, All-Star break and play-by-play");
    // seed 191 put the user's top scorer exactly on the 20-goal milestone
    // threshold, so a small change anywhere in shot rates could tip it either
    // way; 59 clears the scaled goals and points marks with real margin.
    const G = A.newGame(0, { seed: 59, rules: { seasonLen: 41 } });

    const breakDay = G.allStarDay;
    ok(breakDay > 0 && breakDay < G.schedule.length, `the calendar reserves a break (day ${breakDay})`);
    ok([breakDay - 1, breakDay, breakDay + 1].every((d) => !G.schedule[d] || G.schedule[d].length === 0),
      "no games are scheduled across the break");

    simSeason(A, G);
    ok(G.allStar && G.allStar.year === G.year, "the All-Star game was played");
    ok(G.allStar.east.length === 10 && G.allStar.west.length === 10,
      `each side names ten (${G.allStar.east.length}/${G.allStar.west.length})`);
    ok(G.allStar.east.every((id) => G.teams[G.players[id].teamId].conf === 0)
      && G.allStar.west.every((id) => G.teams[G.players[id].teamId].conf === 1),
      "players are on the right side");
    ok(G.allStar.east.filter((id) => G.players[id].pos === "G").length === 1, "each side takes a goalie");
    ok(G.allStar.mvp != null, "an All-Star MVP was named");

    ok(G.records && G.records.goals && G.records.points, "the record book was written");
    const topG = A.playersOf(G).filter((p) => p.pos !== "G")
      .sort((a, b) => b.season.g - a.season.g)[0];
    ok(G.records.goals.v === topG.season.g, "the goals record matches the league leader");

    ok(G.lastGame && G.lastGame.events, "the user's last game kept a play-by-play");
    const kinds = new Set(G.lastGame.events.map((e) => e.kind));
    ok(G.lastGame.events.length > 0, `it has events (${G.lastGame.events.length})`);
    ok([...kinds].every((k) => ["goal", "save", "penalty", "fight", "shootout"].includes(k)),
      `and only known event kinds (${[...kinds].join(", ")})`);
    const evGoals = G.lastGame.events.filter((e) => e.kind === "goal").length;
    const boxGoals = G.lastGame.hg + G.lastGame.ag - (G.lastGame.so ? 1 : 0);
    ok(evGoals === boxGoals, `every goal in the game is in the log (${evGoals} vs ${boxGoals})`);
    const sorted = G.lastGame.events.every((e, i, a) => i === 0 || a[i - 1].t <= e.t);
    ok(sorted, "the log runs in clock order");
    // Drive the machinery directly rather than hoping a random season lands a
    // scorer past a mark — that made this check hostage to the RNG, and it has
    // already broken twice on unrelated changes to shot rates.
    const marked = A.rosterOf(G, G.userTeam).filter((p) => p.pos !== "G")[0];
    marked.marks = null;
    marked.season.g = 60; marked.season.a = 60;
    A.checkMilestones(G);
    ok(marked.marks && Object.keys(marked.marks).length > 0, "milestones fire once a mark is passed");
    const newsBefore = G.news.length;
    A.checkMilestones(G);
    ok(G.news.length === newsBefore, "and the same mark never fires twice");

    simPlayoffs(A, G);
    ok(G.teams.every((t) => t.seasons && t.seasons.length === 1), "every club archived its season");
    const champ = G.teams[G.history[0].champion];
    ok(champ.seasons[0].cup === true, "the champion's season is marked as a Cup year");
    ok(G.teams.filter((t) => t.seasons[0].playoffs).length === 16, "sixteen clubs are recorded as making it");
  },

  // Many seasons in a row: the save must stay bounded and the league legal.
  longevity(A) {
    section("Eight-season soak");
    const G = A.newGame(0, { seed: 201, rules: { seasonLen: 41 } });
    const sizes = [];
    for (let s = 0; s < 8; s++) {
      simSeason(A, G); simPlayoffs(A, G);
      A.autoDraft(G, false);
      A.startNextSeason(G);
      sizes.push(JSON.stringify(G).length / 1048576);
    }
    ok(G.year === 2034, `eight seasons elapsed (through ${G.year})`);
    ok(G.teams.every((t) => t.seasons.length === 8), "every club has eight seasons of history");
    ok(G.teams.every((t) => A.rosterOf(G, t.id).length >= 20), "every club can still dress a roster");
    ok(G.teams.every((t) => A.rosterOf(G, t.id).filter((p) => p.pos === "G").length >= 2),
      "and still has two goaltenders");
    ok(G.teams.every((t) => A.capHit(G, t.id) <= A.rules(G).capAmount + 0.5),
      "nobody drifted over the cap",
      G.teams.filter((t) => A.capHit(G, t.id) > A.rules(G).capAmount + 0.5).map((t) => `${t.abbr} ${A.capHit(G, t.id)}`).join(" "));

    const growth = sizes[7] - sizes[3];
    ok(sizes[7] < 3, `the save stays under the storage ceiling (${sizes[7].toFixed(2)} MB after eight)`);
    ok(growth < sizes[3], `pruning holds growth down (${sizes[3].toFixed(2)} → ${sizes[7].toFixed(2)} MB)`);
    const honoured = G.teams.reduce((s, t) => s + (t.honours || []).length, 0);
    ok(honoured > 0, `clubs honoured their long servers (${honoured})`);
    const records = A.RECORD_DEFS.every((d) => G.records[d.key]);
    ok(records, "every record has a holder");
    // And it still plays.
    simSeason(A, G);
    ok(G.teams.every((t) => t.gp === 41), "the ninth season plays to completion");
  },

  // A save has to round-trip, because that's the whole persistence story.
  save(A) {
    section("Save integrity");
    const G = A.newGame(2, { seed: 131, rules: { seasonLen: 41 } });
    A.simDays(G, 25);
    let json;
    try { json = JSON.stringify(G); } catch (e) { json = null; }
    ok(json != null, "the game serializes");
    const size = json ? json.length / 1024 / 1024 : 99;
    ok(size < 4, `a save fits in localStorage (${size.toFixed(2)} MB)`);
    const G2 = A.migrate(JSON.parse(json));
    ok(G2.teams.length === 32 && Object.keys(G2.players).length === Object.keys(G.players).length,
      "a reloaded save has the same league");
    simSeason(A, G2);
    ok(G2.teams.every((t) => t.gp === 41), "a reloaded save plays out the season");

    // migrate() must survive a save missing newer fields.
    const stripped = JSON.parse(json);
    delete stripped.news; delete stripped.picks; delete stripped.history;
    const G3 = A.migrate(stripped);
    ok(Array.isArray(G3.news) && Array.isArray(G3.picks), "migrate backfills missing fields");
    A.simDay(G3);
    ok(true, "and the migrated save still simulates");

    // Saving must actually land, and a load must come back with what was saved
    // rather than a stale copy from the other store.
    A.saveGame(G, 0);
    const meta = A.slotMeta(0);
    ok(meta && meta.year === G.year, "the slot's metadata reflects what was saved");
    const wrapped = A.unwrap(A.localStorage.getItem("pgmh:slot0"));
    ok(wrapped && wrapped.at > 0, "the payload is written with a timestamp");
    ok(wrapped && wrapped.g.day === G.day, `and holds the current state (day ${wrapped ? wrapped.g.day : "?"} vs ${G.day})`);
    A.simDays(G, 5);
    A.saveGame(G, 0);
    const again = A.unwrap(A.localStorage.getItem("pgmh:slot0"));
    ok(again && again.g.day === G.day, "a later save overwrites the earlier one");
    ok(again.at >= wrapped.at, "and carries a newer timestamp");
    // A bare, pre-wrapper save still loads.
    A.localStorage.setItem("pgmh:slot1", JSON.stringify(G));
    const bare = A.unwrap(A.localStorage.getItem("pgmh:slot1"));
    ok(bare && bare.at === 0 && bare.g.day === G.day, "an old unwrapped save is still readable");
  },

  // The same seed must produce the same season, or nothing above is reproducible.
  determinism(A) {
    section("Determinism");
    const run = () => {
      const G = A.newGame(0, { seed: 4242, rules: { seasonLen: 41 } });
      simSeason(A, G);
      return G.teams.map((t) => `${t.abbr}:${t.pts}:${t.gf}`).join("|");
    };
    ok(run() === run(), "the same seed replays the same season");
  },
};

/* ---------------------------------- main --------------------------------- */
const want = process.argv[2];
const app = loadGame();
console.log(`Pocket GM — Hockey · headless checks${want ? ` (${want})` : ""}`);
const names = want ? [want] : Object.keys(CHECKS);
for (const n of names) {
  if (!CHECKS[n]) { console.error(`unknown check "${n}" — have: ${Object.keys(CHECKS).join(", ")}`); process.exit(2); }
  CHECKS[n](app);
}
console.log(`\n${failures ? "\x1b[31m" : "\x1b[32m"}${checksRun - failures}/${checksRun} passed\x1b[0m`);
process.exit(failures ? 1 : 0);
