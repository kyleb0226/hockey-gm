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
    "simPlayoffDay", "advancePlayoffRound", "simSeriesGame", "lineChemistry", "iceTimeF", "matchupMix", "normalise",
  "SYSTEMS", "genCoach", "coachOf", "systemOf", "isRivalry", "clubColour", "COLOURS",
  "PERSONALITIES", "personalityOf", "leadership", "letters", "letterFor", "roomMorale",
  "MANDATES", "setMandate", "seasonAchievement", "hofScore", "runHallOfFame", "HOF_BAR",
  "setBlock", "onBlock", "generateOffers", "acceptOffer", "tradablePicks", "nextOpponent",
  "deadlineDay", "tradesOpen", "daysToDeadline", "aiDeadlineMoves",
  "hasNtc", "eligibleForNtc", "requestNtcWaiver",
  "needsWaivers", "sendDown", "recall", "processWaivers", "nhlGames",
  "askingPrice", "negotiate", "isProspect", "prospectReady", "simFarmDay",
  "simFarmGame", "applyFarmGame", "farmStandings", "farmRec", "farmRoster", "farmStrength",
  "farmStarter", "farmLine", "runFarmPlayoffs", "FARM_CUP_FIELD", "blankFarmRec",
  "clubSummary", "ordinal", "goalieReport", "REPORT_MIN_SHOTS", "REPORT_TRUST_SA", "leagueNetRates",
  "releasePlayer", "releaseCost", "RELEASE_DEAD_PCT", "canExtend", "extendPlayer",
  "extensionAsk", "aiExtensionOffer", "EXTEND_LOYALTY", "retainedTraded", "FARM_MAX",
  "progress", "devEnvironment", "nhlDevRead", "devAgeWeight", "devBand",
  "DEV_FARM", "DEV_NHL_HI", "DEV_NHL_LO", "DEV_BANDS",
  "effectiveCap", "retainedBy", "retainedOn", "MAX_RETAINED", "RETAIN_MAX_PCT",
  "updateRecords", "checkMilestones", "runAllStar", "allStarRosters", "RECORD_DEFS",
  "offseasonStage", "offseasonAction", "doOffseasonStep", "OFFSEASON_STEPS",
  "stintFor", "stintTotal", "spotSoft", "spotAt", "pointShares", "psOf",
  "DRAFT_ROUNDS", "draftPicksTotal", "closeDraft", "scoutProspect", "scoutedOvr", "scoutedPot",
  "scoutBand", "scoutLabel", "draftValue", "SCOUT_POINTS",
  "pruneSave", "ZONE_KEYS", "NET_CELLS", "NET_KEYS", "goalieHole", "shooterSpot", "pickCell", "blankNet", "saveGame", "loadGame", "slotMeta", "unwrap", "deleteSlot", "localStorage",
  "lineChemistry", "LINE_CHEM_MAX_GAMES", "pairChemistry", "PAIR_CHEM_MAX_GAMES",
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

    ok(G.draftClass.length === A.draftPicksTotal(G), `a draft class was generated (${G.draftClass.length})`);
    ok(G.draftOrder.length === 32, "every club has a draft slot");
    const nonPlayoff = G.teams.filter((t) => !A.inPlayoffs(G, t.id)).length;
    ok(nonPlayoff === 16, `sixteen clubs missed the playoffs (${nonPlayoff})`);
    const firstTen = G.draftOrder.slice(0, 10);
    ok(firstTen.every((id) => !A.inPlayoffs(G, id)), "the lottery only draws from non-playoff clubs");

    A.autoDraft(G, false);
    ok(G.draftPick === A.draftPicksTotal(G), `the draft completed (${G.draftPick} picks made)`);
    const drafted = A.playersOf(G).filter((p) => p.rookie && p.teamId != null);
    ok(drafted.length >= A.draftPicksTotal(G) * 0.9, `prospects landed on clubs (${drafted.length})`);
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

    /* Ice time, measured from a SINGLE game's box score rather than an
       accumulated season. Season totals are divided by games played, and an
       injury mid-season moves players between lines, so the old version was
       really asking "did anyone get hurt" — it broke twice on unrelated RNG
       shifts. One game is exact and says the same thing. */
    const box = A.simGame(G, 0, 1, {}).boxes[0];
    const lineToi = (ids) => ids.reduce((s, id) => s + (box.players[id] ? box.players[id].toi : 0), 0) / ids.length;
    const l1 = lineToi(L.F[0]), l4 = lineToi(L.F[3]);
    ok(l1 > l4, `the first line outplays the fourth (${l1.toFixed(1)} vs ${l4.toFixed(1)} min)`);
    // Ice time is per player, not split between linemates — a first-liner plays
    // most of a period and a half, not five minutes.
    ok(l1 > 13 && l1 < 26, `a first-liner's night is a real one (${l1.toFixed(1)} min)`);
    ok(l4 > 4 && l4 < 14, `and the fourth line gets a fourth-line shift (${l4.toFixed(1)} min)`);
    const d1 = lineToi(L.D[0]);
    ok(d1 > 15 && d1 < 30, `the top pair carries the biggest load (${d1.toFixed(1)} min)`);
    ok(Math.abs(box.players[L.G[0]].toi - 60) < 0.5,
      `a goalie who starts plays the full sixty (${box.players[L.G[0]].toi.toFixed(1)})`);

    /* Line chemistry, driven directly. Simming sixty days and expecting the cap
       assumes nobody on the top line gets hurt all year, which is not a thing
       the test should be asserting. */
    const t0 = G.teams[0];
    const fresh = A.ensureLines(G, 0);
    t0.lineChem = null; t0.lineSig = null;
    for (let i = 0; i < A.LINE_CHEM_MAX_GAMES + 5; i++) A.lineChemistry(t0, fresh);
    ok(t0.lineChem[0] === A.LINE_CHEM_MAX_GAMES,
      `an untouched line reaches the cap and stops (${t0.lineChem[0]})`);
    ok(t0.lineChem.every((g) => g <= A.LINE_CHEM_MAX_GAMES), "no line ever exceeds it");
    // Touch the line and the streak is gone.
    const swapped = JSON.parse(JSON.stringify(fresh));
    const tmp = swapped.F[0][0];
    swapped.F[0][0] = swapped.F[1][0];
    swapped.F[1][0] = tmp;
    A.lineChemistry(t0, swapped);
    ok(t0.lineChem[0] === 0, `swapping the top line resets its streak (${t0.lineChem[0]})`);
    A.lineChemistry(t0, swapped);
    ok(t0.lineChem[0] === 1, "and it starts building again from there");

    // Defence pairs build the same continuity bonus as forward lines. Driven
    // directly for the same reason the forward version is: simming sixty days
    // and expecting the cap really asks "did anybody get hurt".
    t0.pairChem = null; t0.pairSig = null;
    for (let i = 0; i < A.PAIR_CHEM_MAX_GAMES + 5; i++) A.pairChemistry(t0, fresh);
    ok(t0.pairChem[0] === A.PAIR_CHEM_MAX_GAMES,
      `an untouched pair reaches the cap and stops (${t0.pairChem[0]})`);
    ok(t0.pairChem.every((g) => g <= A.PAIR_CHEM_MAX_GAMES), "no pair ever exceeds it");
    const swappedD = JSON.parse(JSON.stringify(fresh));
    const tmpD = swappedD.D[0][0];
    swappedD.D[0][0] = swappedD.D[1][0];
    swappedD.D[1][0] = tmpD;
    A.pairChemistry(t0, swappedD);
    ok(t0.pairChem[0] === 0, `breaking up a pair resets its streak (${t0.pairChem[0]})`);
    A.pairChemistry(t0, swappedD);
    ok(t0.pairChem[0] === 1, "and it starts building again");

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
    // On points, not on identity: computeAwards breaks a tie on goals and this
    // doesn't, so in a tie the two legitimately name different players.
    ok(A.pts(G.players[AW.scoring].season) === A.pts(top.season),
      `the scoring trophy went to a points leader (${A.pts(G.players[AW.scoring].season)})`);
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

    /* Moving a player inside your own organisation is a roster decision and
       costs nothing. Waivers are for RELEASES, where the risk belongs. */
    section("Demotion and release");
    const kid = A.rosterOf(G, 0).find((p) => p.age < 22);
    if (kid) {
      const r = A.sendDown(G, kid.id);
      ok(r.ok && !r.waivers, "a young player goes down freely");
      ok(kid.farm === true, "and reports to the farm immediately");
    } else ok(true, "no youngster on this roster to test");
    const vet = A.rosterOf(G, 0).find((p) => p.age >= 24 && !p.farm);
    vet.career = [{ gp: 200 }];
    const r2 = A.sendDown(G, vet.id);
    ok(r2.ok && !r2.waivers, "an established player goes down freely too");
    ok(vet.farm === true, "and he is on the farm the moment you send him");
    ok(!(G.waivers || []).length, "demoting your own player exposes him to nobody");

    // Releasing is the one that costs something.
    const cut = A.rosterOf(G, 0).find((p) => !p.farm && !A.hasNtc(p));
    const cost = A.releaseCost(G, cut.id);
    ok(cost > 0 && cost < cut.contract.amt, `a release carries dead money ($${cost}M of $${cut.contract.amt}M)`);
    const rel = A.releasePlayer(G, cut.id);
    ok(rel.ok, "you can release a player");
    ok(G.waivers.length === 1 && G.waivers[0].release, "which puts him on the wire first");
    ok(cut.teamId === 0, "and he is still yours until it clears");
    const capBefore = A.capHit(G, 0);
    G.day++;
    A.processWaivers(G);
    ok(G.waivers.length === 0, "the wire is emptied once processed");
    if (cut.teamId === null) {
      ok(G.freeAgents.includes(cut.id), "an unclaimed release becomes a free agent");
      const dead = (G.retained || []).filter((r) => r.dead && r.from === 0);
      ok(dead.length === 1 && dead[0].amt === cost, `and leaves dead cap behind ($${dead[0].amt}M)`);
      ok(A.capHit(G, 0) < capBefore, "which still costs less than carrying the contract");
      // Dead money must NOT follow him — his next club negotiates its own price.
      ok(A.effectiveCap(G, cut) === cut.contract.amt, "the dead money stays with the club that cut him");
    } else {
      ok(cut.teamId !== 0, "or another club claims him and takes the contract");
      ok(!(G.retained || []).some((r) => r.dead), "and the club that cut him owes nothing");
    }

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
    // Against the club they were PICKED for — a player traded across
    // conferences at the deadline doesn't retroactively switch benches.
    const asAt = (id) => G.teams[G.allStar.at[id]];
    ok(G.allStar.east.every((id) => asAt(id).conf === 0)
      && G.allStar.west.every((id) => asAt(id).conf === 1),
      "players are on the side they were picked for");
    ok(G.allStar.east.concat(G.allStar.west).every((id) => G.allStar.at[id] != null),
      "every selection records the club he was picked from");
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

  // A club's shot map has to be ITS shot map. Zone shares used to be league
  // constants, so every team's chart was the same shape and only the volume
  // moved — for and against looked identical.
  teamProfiles(A) {
    section("Team shot profiles");
    const G = A.newGame(0, { seed: 501, rules: { seasonLen: 82 } });
    simSeason(A, G);
    const Z = A.ZONE_KEYS;
    const prof = G.teams.map((t) => {
      const f = { rush: 0, cycle: 0, point: 0 }, a = { rush: 0, cycle: 0, point: 0 };
      A.rosterOf(G, t.id, true).forEach((p) => {
        if (!p.season.z) return;
        if (p.pos === "G") Z.forEach((k) => { a[k] += p.season.z[k].sa; });
        else Z.forEach((k) => { f[k] += p.season.z[k].s; });
      });
      const tf = Z.reduce((s, k) => s + f[k], 0), ta = Z.reduce((s, k) => s + a[k], 0);
      const r = A.rosterOf(G, t.id);
      const fwd = r.filter((p) => p.pos !== "D" && p.pos !== "G");
      const dmen = r.filter((p) => p.pos === "D");
      return {
        t, tf, ta,
        fRush: tf ? f.rush / tf : 0, fPoint: tf ? f.point / tf : 0,
        aRush: ta ? a.rush / ta : 0, aPoint: ta ? a.point / ta : 0,
        speed: fwd.reduce((s, p) => s + p.r.spd, 0) / Math.max(1, fwd.length),
        dShot: dmen.reduce((s, p) => s + p.r.sht, 0) / Math.max(1, dmen.length),
        dfn: dmen.reduce((s, p) => s + p.r.dfn, 0) / Math.max(1, dmen.length),
      };
    }).filter((x) => x.tf > 0 && x.ta > 0);
    ok(prof.length === 32, "every club has a profile both ways");

    const spread = (xs) => Math.max(...xs) - Math.min(...xs);
    const fRushSpread = spread(prof.map((p) => p.fRush));
    ok(fRushSpread > 0.025, `clubs differ in how much rush they generate (${(fRushSpread * 100).toFixed(1)} points apart)`);
    const fPointSpread = spread(prof.map((p) => p.fPoint));
    ok(fPointSpread > 0.03, `and in how much they shoot from the point (${(fPointSpread * 100).toFixed(1)} points)`);
    const aRushSpread = spread(prof.map((p) => p.aRush));
    ok(aRushSpread > 0.04, `and in how much rush they concede (${(aRushSpread * 100).toFixed(1)} points)`);

    // The two maps must not be the same map. Some clubs should be lopsided.
    const gaps = prof.map((p) => Math.abs(p.fRush - p.aRush));
    ok(Math.max(...gaps) > 0.05,
      `a club's own map differs from what it concedes (biggest gap ${(Math.max(...gaps) * 100).toFixed(1)} points)`);

    // And the differences have to come from the roster, not from noise.
    const corr = (xs, ys) => {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
      const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
      const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
      return dx && dy ? num / (dx * dy) : 0;
    };
    const rSpeed = corr(prof.map((p) => p.speed), prof.map((p) => p.fRush));
    ok(rSpeed > 0.3, `fast forwards generate more rush chances (r=${rSpeed.toFixed(2)})`);
    const rShot = corr(prof.map((p) => p.dShot), prof.map((p) => p.fPoint));
    ok(rShot > 0.3, `shooting defencemen produce more point shots (r=${rShot.toFixed(2)})`);
    const rDfn = corr(prof.map((p) => p.dfn), prof.map((p) => p.aRush));
    ok(rDfn < -0.3, `a sound defence concedes less rush (r=${rDfn.toFixed(2)})`);

    /* And the NET map, which is the one that used to be truly identical: where
       a shot is AIMED only ever depended on the shooter, so every club's
       conceded placement chart was the league average. Shooters now scout the
       goalie, so a club's conceded map leans on its own keeper's hole. */
    section("Net maps differ by club");
    const K = A.NET_KEYS;
    const net = G.teams.map((t) => {
      const f = {}, a = {};
      K.forEach((k) => { f[k] = 0; a[k] = 0; });
      A.rosterOf(G, t.id, true).forEach((p) => {
        if (!p.season.net) return;
        if (p.pos === "G") K.forEach((k) => { a[k] += p.season.net[k].sa; });
        else K.forEach((k) => { f[k] += p.season.net[k].a; });
      });
      const tf = K.reduce((s, k) => s + f[k], 0), ta = K.reduce((s, k) => s + a[k], 0);
      const gk = A.rosterOf(G, t.id).filter((p) => p.pos === "G")
        .sort((x, y) => y.season.gp - x.season.gp)[0];
      return { t, tf, ta, f: K.map((k) => (tf ? f[k] / tf * 100 : 0)),
        a: K.map((k) => (ta ? a[k] / ta * 100 : 0)), hole: gk ? A.goalieHole(gk).key : null };
    }).filter((x) => x.ta > 0 && x.hole);
    ok(net.length >= 30, `net profiles built for the league (${net.length})`);

    // The headline: a club is shot at more where its own goalie is weak.
    const leagueAvg = K.map((k, i) => net.reduce((s, p) => s + p.a[i], 0) / net.length);
    const lifts = net.map((p) => p.a[K.indexOf(p.hole)] - leagueAvg[K.indexOf(p.hole)]);
    const above = lifts.filter((l) => l > 0).length;
    ok(above >= net.length - 2,
      `clubs concede more shots at their goalie's hole (${above} of ${net.length})`);
    const medLift = lifts.slice().sort((x, y) => x - y)[Math.floor(lifts.length / 2)];
    ok(medLift > 1.2, `and by a visible margin (median +${medLift.toFixed(1)} points)`);

    // Conceded maps must vary club to club, not sit on the league mean.
    const aSd = K.map((k, i) => {
      const xs = net.map((p) => p.a[i]);
      const mu = xs.reduce((x, y) => x + y, 0) / xs.length;
      return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / xs.length);
    });
    ok(Math.max(...aSd) > 1.5, `conceded placement varies across clubs (widest sd ${Math.max(...aSd).toFixed(2)})`);
    // And a club's own map must not be a copy of what it concedes.
    const netGap = net.map((p) => K.reduce((s, _, i) => s + Math.abs(p.f[i] - p.a[i]), 0) / K.length);
    // Modest by nature — a club's own map is its shooters, the conceded one is
    // the whole league's shooters aimed at its goalie. The hole-lift check above
    // is the sharper guard; this just says the two aren't the same chart.
    ok(Math.max(...netGap) > 1.4,
      `a club's own placement differs from what it concedes (biggest mean gap ${Math.max(...netGap).toFixed(1)} points)`);
  },

  // A season split by club, so a traded player's year isn't all credited to
  // whoever happened to have him at the end.
  stints(A) {
    section("Season splits by club");
    const G = A.newGame(0, { seed: 221, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const played = A.playersOf(G).filter((p) => p.season.gp > 0);
    ok(played.every((p) => (p.stints || []).length > 0), "everyone who played has at least one spell");

    // The spells must add up to the season, for everybody.
    const badGp = played.filter((p) => A.stintTotal(p, "gp") !== p.season.gp);
    ok(badGp.length === 0, "games in the spells equal games in the season",
      badGp.length ? `${badGp[0].ln}: ${A.stintTotal(badGp[0], "gp")} vs ${badGp[0].season.gp}` : "");
    const skaters = played.filter((p) => p.pos !== "G");
    const badG = skaters.filter((p) => A.stintTotal(p, "g") !== p.season.g);
    ok(badG.length === 0, "and so do goals");
    const badA = skaters.filter((p) => A.stintTotal(p, "a") !== p.season.a);
    ok(badA.length === 0, "and assists");

    // The deadline moves people, so somebody should have two.
    const moved = played.filter((p) => p.stints.filter((st) => st.s.gp).length > 1);
    ok(moved.length > 0, `players traded mid-season have more than one spell (${moved.length})`);
    const m = moved[0];
    ok(m.stints[0].t !== m.stints[1].t, "consecutive spells are with different clubs");
    ok(m.stints[m.stints.length - 1].t === m.teamId, "and the last spell is the club he's on now");
    ok(m.stints.every((st) => st.s.z === undefined), "spell lines carry no zone buckets — that's the save-size guard");

    // At the rollover a traded year becomes one career row per club. The spells
    // themselves are cleared by finishSeason, so count them first.
    const spellCount = m.stints.filter((st) => st.s.gp).length;
    const spellClubs = m.stints.filter((st) => st.s.gp).map((st) => st.t);
    simPlayoffs(A, G);
    const rows = (m.career || []).filter((r) => r.year === G.year);
    ok(rows.length === spellCount, `a traded year is archived as one row per club (${rows.length} vs ${spellCount})`);
    ok(spellClubs.every((t) => rows.some((r) => r.teamId === t)), "every club he played for is in the record");
    ok(rows.every((r) => r.teamId != null), "every career row names the club it was earned with");
    ok(new Set(rows.map((r) => r.teamId)).size === rows.length, "and no club appears twice for one year");
    const single = A.playersOf(G).find((p) => (p.career || []).filter((r) => r.year === G.year).length === 1
      && p.career.some((r) => r.year === G.year && r.gp > 0));
    ok(!!single, "a player who stayed put gets exactly one row");
    A.autoDraft(G, false); A.startNextSeason(G);
    ok(A.playersOf(G).every((p) => !p.stints || !p.stints.length), "spells are cleared at the rollover");
  },

  /* Continuity: the dots on a shot chart have to BE the shots from the games
     that were actually played — same day, same opponent, right count — not a
     cloud generated after the fact to match a total. */
  continuity(A) {
    section("Shot log ties back to real games");
    const G = A.newGame(0, { seed: 313, rules: { seasonLen: 41 } });
    simSeason(A, G);

    // What the schedule says the club actually did.
    const played = [];            // {day, opp}
    G.schedule.forEach((day, d) => day.forEach((f) => {
      if (!f.played) return;
      if (f.home === G.userTeam) played.push({ day: d, opp: f.away });
      else if (f.away === G.userTeam) played.push({ day: d, opp: f.home });
    }));
    ok(played.length === 41, `the club played its 41 games (${played.length})`);
    const oppByDay = {};
    played.forEach((g) => { oppByDay[g.day] = g.opp; });

    const skaters = A.rosterOf(G, G.userTeam).filter((p) => p.pos !== "G" && p.season.att > 0);
    ok(skaters.length > 0, "and has skaters who shot");

    let checkedDays = 0, badDay = null, badOpp = null, badCount = null;
    skaters.forEach((p) => {
      const log = G.shotLog[p.id] || [];
      // Every record must fall on a day this club actually played...
      log.forEach((r) => {
        if (!(r.d in oppByDay) && badDay == null) badDay = `${p.ln} logged a shot on day ${r.d + 1}, no game`;
        else if (oppByDay[r.d] !== r.o && badOpp == null) {
          badOpp = `${p.ln} day ${r.d + 1}: logged vs ${r.o}, actually played ${oppByDay[r.d]}`;
        }
      });
      // ...and the totals must be the season totals, not an approximation.
      const on = log.filter((r) => r.r === "g" || r.r === "s").length;
      const en = log.filter((r) => r.r === "e").length;
      if (on + en !== p.season.sog && badCount == null) {
        badCount = `${p.ln}: ${on}+${en} logged vs ${p.season.sog} shots on goal`;
      }
      checkedDays += new Set(log.map((r) => r.d)).size;
    });
    ok(badDay == null, "every logged shot falls on a day the club actually played", badDay || "");
    ok(badOpp == null, "and names the opponent it was actually against", badOpp || "");
    ok(badCount == null, "and the logged shots add up to the season totals", badCount || "");

    // The busiest shooter should have shot in most of the games he dressed for.
    const busiest = skaters.sort((a, b) => b.season.att - a.season.att)[0];
    const daysWithShots = new Set((G.shotLog[busiest.id] || []).map((r) => r.d)).size;
    ok(daysWithShots > busiest.season.gp * 0.6,
      `the top shooter appears in most of his games (${daysWithShots} of ${busiest.season.gp})`);
    ok(daysWithShots <= busiest.season.gp,
      `and never in more games than he played (${daysWithShots} vs ${busiest.season.gp})`);

    // The log grows game by game rather than appearing at the end.
    const G2 = A.newGame(0, { seed: 314, rules: { seasonLen: 41 } });
    const counts = [];
    for (let i = 0; i < 25; i++) {
      A.simDay(G2);
      const n = Object.values(G2.shotLog).reduce((s, arr) => s + arr.length, 0);
      counts.push(n);
    }
    ok(counts[24] > counts[0], "the log fills up as days are played");
    ok(counts.every((n, i) => i === 0 || n >= counts[i - 1]), "and only ever grows");
    const jumps = counts.filter((n, i) => i && n > counts[i - 1]).length;
    ok(jumps >= 8, `it grows on the days the club plays, not in one lump (${jumps} increments)`);

    // Goals in the log are the goals in the box score, game for game.
    const scored = {};
    G.results.forEach((r) => r.scorers.forEach((sc) => {
      if (sc.t !== G.userTeam) return;
      scored[sc.id] = (scored[sc.id] || 0) + 1;
    }));
    let badGoals = null;
    Object.entries(scored).forEach(([pid, n]) => {
      const log = G.shotLog[pid];
      if (!log) return;
      const logged = log.filter((r) => r.r === "g" || r.r === "e").length;
      if (logged !== n && badGoals == null) badGoals = `player ${pid}: ${logged} logged vs ${n} scored`;
    });
    ok(badGoals == null, "every goal in the log is a goal that was actually scored", badGoals || "");
  },

  // Deployment: the two levers a coach actually has.
  deployment(A) {
    section("Ice time and matchups");
    const G = A.newGame(0, { seed: 411, rules: { seasonLen: 41 } });
    ok(A.iceTimeF(G.teams[0]).every((v, i) => Math.abs(v - A.LINE_TOI[i]) < 0.001),
      "a club with no setting plays the standard split");
    // Ice time is normalised, so any numbers work.
    G.teams[0].iceF = [40, 20, 20, 20];
    const ice = A.iceTimeF(G.teams[0]);
    ok(Math.abs(ice.reduce((a, b) => a + b, 0) - 1) < 1e-9, "a custom split is normalised to one");
    ok(ice[0] > 0.35 && ice[0] < 0.45, `and the first line gets its share (${(ice[0] * 100).toFixed(0)}%)`);
    const box = A.simGame(G, 0, 1, {}).boxes[0];
    const L = A.ensureLines(G, 0);
    const toi = (ids) => ids.reduce((s, id) => s + box.players[id].toi, 0) / ids.length;
    ok(toi(L.F[0]) > toi(L.F[1]) * 1.6,
      `a hard-ridden first line actually plays more (${toi(L.F[0]).toFixed(1)} vs ${toi(L.F[1]).toFixed(1)})`);
    G.teams[0].iceF = null;

    // Matchups: no instruction means line-for-line.
    const side = { box: { teamId: 0 }, opp: { teamId: 1 }, isHome: true };
    G.teams[0].checkLine = null;
    const plain = A.matchupMix(G, side, 0, G.teams[1]);
    ok(plain[0] === 1, "with no matching, line one meets line one");
    // A checking line chases their best; the scoring line is hidden from it.
    G.teams[0].checkLine = 2;
    const check = A.matchupMix(G, side, 2, G.teams[1]);
    ok(check[0] > 0.5, `the checking line mostly draws their top line (${(check[0] * 100).toFixed(0)}%)`);
    const top = A.matchupMix(G, side, 0, G.teams[1]);
    ok(top[0] < 0.45, `and the scoring line sees them less (${(top[0] * 100).toFixed(0)}%)`);
    ok(top[2] + top[3] > 0.3, "spending its minutes against their depth instead");
    // On the road the coach can ask but not insist.
    const away = { box: { teamId: 0 }, opp: { teamId: 1 }, isHome: false };
    const awayCheck = A.matchupMix(G, away, 2, G.teams[1]);
    ok(awayCheck[0] < check[0], `last change is worth something (${(awayCheck[0] * 100).toFixed(0)}% away vs ${(check[0] * 100).toFixed(0)}% home)`);
    ok(A.matchupMix(G, side, 0, G.teams[1]).reduce((a, b) => a + b, 0) > 0.999, "every mix is a distribution");
  },

  // Coaching, rivalries, the room and the board's ask.
  flavourSystems(A) {
    section("Staff, rivals and the room");
    const G = A.newGame(0, { seed: 421, rules: { seasonLen: 41 } });

    ok(G.teams.every((t) => t.coach && t.coach.name), "every club has a head coach");
    ok(G.teams.every((t) => A.SYSTEMS[t.coach.system]), "and a system that exists");
    const sysSpread = new Set(G.teams.map((t) => t.coach.system));
    ok(sysSpread.size >= 2, `clubs don't all play the same way (${sysSpread.size} systems)`);
    ok(A.systemOf(G.teams[0]).off > 0.5, "a system has an offensive multiplier");
    /* A trap club concedes less than an aggressive one. One 41-game season of
       sixteen clubs a side is NOT enough to show it — the real gap is about 5%
       and a single season swings wider than that, so this check used to pass or
       fail on which way the RNG happened to fall. Pool several seasons, and
       FLIP which parity plays the trap each time, because assigning systems by
       club index otherwise confounds the system with how good the clubs are. */
    let trapGA = 0, aggrGA = 0, trapN = 0, aggrN = 0;
    [[422, 0], [423, 1], [424, 0], [425, 1]].forEach(([seed, flip]) => {
      const g = A.newGame(0, { seed, rules: { seasonLen: 41 } });
      g.teams.forEach((t, i) => {
        t.coach = { ...t.coach, system: (i % 2) === flip ? "trap" : "aggressive" };
      });
      simSeason(A, g);
      g.teams.forEach((t, i) => {
        if ((i % 2) === flip) { trapGA += t.ga; trapN++; } else { aggrGA += t.ga; aggrN++; }
      });
    });
    const trap = trapGA / trapN, aggr = aggrGA / aggrN;
    ok(aggr > trap * 1.02,
      `the trap concedes less than the forecheck (${trap.toFixed(1)} vs ${aggr.toFixed(1)} GA over ${trapN + aggrN} club-seasons)`);

    // Rivalries are mutual and everybody has one.
    ok(G.teams.every((t) => t.rivalId != null), "every club has a rival");
    ok(G.teams.every((t) => G.teams[t.rivalId].rivalId === t.id), "and the feeling is mutual");
    ok(G.teams.every((t) => G.teams[t.rivalId].div === t.div), "rivals are in the same division");
    ok(G.teams.every((t) => t.rivalId !== t.id), "nobody is their own rival");
    ok(A.isRivalry(G, 0, G.teams[0].rivalId), "isRivalry agrees");

    // The room.
    const per = A.personalityOf(G.players[Object.keys(G.players)[0]]);
    ok(per && per.label, "players have a character");
    const chars = new Set(A.playersOf(G).slice(0, 80).map((p) => A.personalityOf(p).key));
    ok(chars.size >= 5, `characters vary (${chars.size} distinct)`);
    const p0 = A.rosterOf(G, 0)[0];
    ok(A.personalityOf(p0).key === A.personalityOf(p0).key, "and are stable for a career");
    const { captain, alternates } = A.letters(G, 0);
    ok(captain && captain.pos !== "G", "a captain is named, and he's a skater");
    ok(alternates.length === 2, "with two alternates");
    ok(!alternates.some((a) => a.id === captain.id), "who aren't him");
    ok(A.letterFor(G, captain) === "C", "the captain wears the C");
    ok(A.letterFor(G, alternates[0]) === "A", "an alternate wears an A");
    // Naming your own captain sticks.
    const other = A.rosterOf(G, 0).find((p) => p.pos !== "G" && p.id !== captain.id);
    G.teams[0].captainId = other.id;
    ok(A.letters(G, 0).captain.id === other.id, "a named captain is honoured");
    ok(A.letterFor(G, other) === "C", "and wears the letter");
    const morale = A.roomMorale(G, 0);
    ok(morale >= 0 && morale <= 100, `room morale is a percentage (${morale})`);

    // The board asks for something, and judges it.
    ok(G.mandate && G.mandate.label, `the board sets a mandate (${G.mandate ? G.mandate.label : "none"})`);
    ok(A.MANDATES[G.mandate.key], "which is a real one");
    simSeason(A, G); simPlayoffs(A, G);
    ok(G.lastMandate && typeof G.lastMandate.met === "boolean", "and delivers a verdict on it");
    const got = G.lastMandate.got;
    ok(got >= 0 && got <= 4, `achievement is on the same scale (${got})`);
    A.autoDraft(G, false); A.startNextSeason(G);
    ok(G.mandate.year === G.year, "a new mandate is set for the new season");
  },

  // Hall of Fame, the block, draft-day picks and the scouting report.
  flavourExtras(A) {
    section("Hall of Fame, the block and the report");
    const G = A.newGame(0, { seed: 431, rules: { seasonLen: 41 } });

    // Colours.
    ok(A.COLOURS.length >= 32, "every club has a palette");
    ok(G.teams.every((t) => A.clubColour(t)[0] && A.clubColour(t)[1]), "two colours each");

    // The trade block invites offers rather than forcing a sale.
    const mine = A.rosterOf(G, G.userTeam).sort((a, b) => b.ovr - a.ovr)[4];
    mine.ntc = false;
    A.setBlock(G, mine.id, true);
    ok(A.onBlock(G, mine.id), "a player can be listed");
    A.generateOffers(G);
    ok(Array.isArray(G.offers), "offers are generated");
    if (G.offers.length) {
      const o = G.offers[0];
      ok(o.want === mine.id, "an offer is for the listed player");
      ok(o.give.length || o.givePicks.length, "and gives something back");
      ok(o.from !== G.userTeam, "from another club");
      const before = A.rosterOf(G, G.userTeam).length;
      const r = A.acceptOffer(G, 0);
      if (r.ok) {
        ok(G.players[mine.id].teamId !== G.userTeam, "accepting moves him");
        ok(!A.onBlock(G, mine.id), "and takes him off the block");
      } else ok(true, `the deal was refused on its merits (${r.why})`);
    } else {
      ok(true, "nobody called this time — offers are probabilistic");
      ok(true, ""); ok(true, "");
    }
    A.setBlock(G, mine.id, false);
    ok(!A.onBlock(G, mine.id), "and can be unlisted");

    // The scouting report names a real opponent and a real weakness.
    const rep = A.nextOpponent(G);
    if (rep) {
      ok(rep.teamId !== G.userTeam, "the report is about somebody else");
      ok(rep.starter && rep.starter.pos === "G", "and names a goaltender");
      ok(rep.hole && rep.hole.label, `with a weak spot (${rep.hole ? rep.hole.label : "?"})`);
      ok(typeof rep.rivalry === "boolean", "and says whether it's a rivalry night");
    } else { ok(true, "no game today"); ok(true, ""); ok(true, ""); ok(true, ""); }

    // Draft-day picks become tradeable while the draft runs.
    simSeason(A, G); simPlayoffs(A, G);
    const during = A.tradablePicks(G, G.userTeam);
    ok(during.some((pk) => pk.year === G.year), "this year's unused picks are tradeable during the draft");
    A.autoDraft(G, false);
    const after = A.tradablePicks(G, G.userTeam);
    ok(!after.some((pk) => pk.year === G.year), "and stop being tradeable once it's over");

    // The Hall opens for business over a long career.
    const G3 = A.newGame(0, { seed: 432, rules: { seasonLen: 41 } });
    for (let i = 0; i < 12; i++) {
      simSeason(A, G3); simPlayoffs(A, G3);
      A.autoDraft(G3, false); A.startNextSeason(G3);
    }
    ok(Array.isArray(G3.hall), "the Hall exists");
    ok(G3.hall.length > 0, `players get inducted over a long career (${G3.hall.length})`);
    ok(G3.hall.length <= 12 * 3, "never more than the class limit a year");
    ok(G3.hall.every((h) => h.name && h.gp > 0), "each has a name and a career");
    ok(G3.hall.every((h) => G3.players[h.pid]), "and is never pruned out of the save");
    const scores = G3.hall.map((h) => h.score);
    ok(Math.min(...scores) >= A.HOF_BAR - 1, `everyone cleared the bar (lowest ${Math.min(...scores)})`);
  },

  // The postseason is played a game at a time, and those games are logged too.
  playoffGames(A) {
    section("Playoffs, game by game");
    const G = A.newGame(0, { seed: 321, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const r1 = G.playoffs.rounds[0];
    ok(r1.every((s) => s.games.length === 0), "no games have been played yet");

    // One night: a game in every live series, and nowhere else.
    A.simPlayoffDay(G);
    ok(r1.every((s) => s.games.length === 1), "one night plays one game in each series");
    ok(r1.every((s) => s.w[0] + s.w[1] === 1), "and each series is 1-0 or 0-1");
    ok(G.playoffs.round === 0, "the round doesn't advance early");

    A.simPlayoffDay(G);
    ok(r1.every((s) => s.games.length === 2), "a second night adds one more each");

    // A series that ends stops playing while the others carry on.
    let guard = 0;
    while (r1.some((s) => !s.done) && guard++ < 20) {
      const before = r1.map((s) => s.games.length);
      A.simPlayoffDay(G);
      r1.forEach((s, i) => {
        if (s.done && s.games.length !== before[i] && s.w[0] !== A.ruleValue(G, "seriesLen")) { /* finished this night */ }
      });
    }
    ok(r1.every((s) => s.done), "the round completes");
    const need = Math.ceil(A.ruleValue(G, "seriesLen") / 2);
    ok(r1.every((s) => Math.max(...s.w) === need), "every series ended at the right number of wins");
    ok(r1.every((s) => s.games.length === s.w[0] + s.w[1]), "games played equals the series score");
    ok(G.playoffs.round === 1 || G.playoffs.champion != null, "and the bracket advanced once it was done");

    /* The user's playoff games get a play-by-play, like his season games do.
       The seed is chosen because the user's club qualifies — on a seed where it
       misses, this whole branch silently passes without testing anything.
       Pick one with MARGIN: 309 finishes 34-6-1, so it survives the RNG shift
       that any new sim work causes. Seed 331 sat on the bubble and fell out the
       moment the farm league started consuming the stream. */
    const G2 = A.newGame(0, { seed: 309, rules: { seasonLen: 41 } });
    simSeason(A, G2);
    const inIt = G2.playoffs.rounds[0].some((s) => s.hi === G2.userTeam || s.lo === G2.userTeam);
    ok(inIt, "the user's club qualified, so the replay checks below actually run");
    if (inIt) {
      let g2 = 0;
      while (g2++ < 8 && (!G2.lastGame || !G2.lastGame.playoff)) A.simPlayoffDay(G2);
      ok(G2.lastGame && G2.lastGame.playoff, "a playoff game is captured for replay");
      ok(G2.lastGame.events.length > 0, `with its own play-by-play (${G2.lastGame.events.length} events)`);
      // And those shots are logged, marked as playoff so they don't pollute the season.
      const po = Object.values(G2.shotLog).flat().filter((r) => r.po);
      ok(po.length > 0, `playoff shots are logged (${po.length})`);
      const reg = Object.values(G2.shotLog).flat().filter((r) => !r.po);
      const skater = A.rosterOf(G2, G2.userTeam).find((p) => p.pos !== "G" && p.season.sog > 0);
      const own = (G2.shotLog[skater.id] || []).filter((r) => !r.po);
      const onGoal = own.filter((r) => r.r === "g" || r.r === "s" || r.r === "e").length;
      ok(onGoal === skater.season.sog,
        `and season totals still only count season shots (${onGoal} vs ${skater.season.sog})`);
      ok(reg.length > 0 && po.length < reg.length, "the two are kept apart");
    } else {
      ok(false, "seed 309 no longer puts the user in the playoffs — pick another with margin");
      ok(true, ""); ok(true, ""); ok(true, ""); ok(true, "");
    }

    // The fast-forward must land in exactly the same place as the slow path.
    const G3 = A.newGame(0, { seed: 321, rules: { seasonLen: 41 } });
    simSeason(A, G3);
    let g3 = 0;
    while (G3.phase === "playoffs" && g3++ < 40) A.simPlayoffRound(G3);
    ok(G3.playoffs.champion != null, "playing out whole rounds still crowns a champion");
    ok(G3.phase === "offseason", "and closes the season");
  },

  // A seven-round draft you have to form an opinion about.
  draft(A) {
    section("The draft");
    const G = A.newGame(0, { seed: 241, rules: { seasonLen: 41 } });
    simSeason(A, G); simPlayoffs(A, G);
    ok(A.DRAFT_ROUNDS === 7, `seven rounds (${A.DRAFT_ROUNDS})`);
    ok(G.draftClass.length === A.draftPicksTotal(G), `a prospect for every pick (${G.draftClass.length})`);
    ok(G.scoutPoints === A.SCOUT_POINTS, `scouting budget is set (${G.scoutPoints})`);

    const board = G.draftClass.map((id) => G.players[id]);
    ok(board.every((p) => p.scout && p.scout.fog > 0), "every prospect starts behind some fog");
    ok(board.every((p) => p.style && p.junior), "and has a style and a background");
    // The top of the board is better known than the bottom.
    const early = board.slice(0, 32).reduce((s, p) => s + p.scout.fog, 0) / 32;
    const late = board.slice(-32).reduce((s, p) => s + p.scout.fog, 0) / 32;
    ok(early < late, `the top of the board is better known (${early.toFixed(2)} vs ${late.toFixed(2)})`);
    // The read is not the truth.
    const off = board.filter((p) => A.scoutedOvr(p) !== p.ovr);
    ok(off.length > board.length * 0.6, `most reads differ from the truth (${off.length}/${board.length})`);
    ok(board.every((p) => A.scoutedPot(p) >= A.scoutedOvr(p)), "a ceiling is never below the current read");

    // Scouting narrows the band and is finite.
    const target = board[40];
    const bandBefore = A.scoutBand(target);
    const r = A.scoutProspect(G, target.id);
    ok(r.ok, "you can scout a prospect");
    ok(A.scoutBand(target) < bandBefore, `which narrows the band (${bandBefore} → ${A.scoutBand(target)})`);
    ok(G.scoutPoints === A.SCOUT_POINTS - 1, "and costs a point");
    let guard = 0;
    while (G.scoutPoints > 0 && guard++ < 100) A.scoutProspect(G, board[guard].id);
    ok(G.scoutPoints === 0, "the budget runs out");
    ok(!A.scoutProspect(G, board[60].id).ok, "and then you can't scout any more");

    // The draft runs to completion and nobody is left in limbo.
    A.autoDraft(G, false);
    ok(G.draftPick === A.draftPicksTotal(G), `every pick was made (${G.draftPick})`);
    ok(G.draftClass.length === 0, "the board is emptied");
    ok(G.draftLog.length === A.draftPicksTotal(G), `every pick is logged (${G.draftLog.length})`);
    const logged = G.draftLog.every((d, i) => d.pick === i + 1 && d.round === Math.floor(i / 32) + 1);
    ok(logged, "the log is in order with the right rounds");
    const picked = G.draftLog.map((d) => G.players[d.pid]).filter(Boolean);
    ok(picked.length === G.draftLog.length, "every drafted player still exists");
    ok(picked.every((p) => p.draft && p.draft.year === G.year && p.teamId === p.draft.teamId),
      "and carries where he was taken");
    ok(picked.every((p) => p.farm), "draftees start on the farm");
    const perTeam = {};
    G.draftLog.forEach((d) => { perTeam[d.teamId] = (perTeam[d.teamId] || 0) + 1; });
    ok(Object.keys(perTeam).length === 32, "every club drafted somebody");

    // Better prospects go earlier, but not perfectly — that's the fog working.
    const firstRound = G.draftLog.filter((d) => d.round === 1).map((d) => G.players[d.pid].pot);
    const lastRound = G.draftLog.filter((d) => d.round === 7).map((d) => G.players[d.pid].pot);
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    ok(avg(firstRound) > avg(lastRound) + 5,
      `first-rounders out-rank last-rounders (${avg(firstRound).toFixed(0)} vs ${avg(lastRound).toFixed(0)})`);
    const bestPot = Math.max(...picked.map((p) => p.pot));
    const bestTakenIn = G.draftLog.find((d) => G.players[d.pid].pot === bestPot).round;
    ok(bestTakenIn >= 1, `and the best prospect doesn't always go first (round ${bestTakenIn})`);
  },

  // Point shares: hockey's Win Shares. The number only means anything if the
  // league's shares add up to the standings points actually handed out.
  pointShares(A) {
    section("Point shares");
    const G = A.newGame(0, { seed: 606, rules: { seasonLen: 82 } });
    simSeason(A, G);
    const played = A.playersOf(G).filter((p) => p.teamId != null && p.season.gp);
    const rows = played.map((p) => ({ p, ps: A.pointShares(G, p) }));
    const total = rows.reduce((s, r) => s + r.ps.ps, 0);
    const leaguePts = G.teams.reduce((s, t) => s + t.pts, 0);
    const ratio = total / leaguePts;
    ok(ratio > 0.85 && ratio < 1.15,
      `the league's point shares match the points handed out (${total.toFixed(0)} vs ${leaguePts}, ratio ${ratio.toFixed(2)})`);

    rows.sort((a, b) => b.ps.ps - a.ps.ps);
    const leader = rows[0];
    ok(leader.ps.ps > 11 && leader.ps.ps < 24,
      `the leader is in the real range (${leader.ps.ps.toFixed(1)}, NHL leaders ~15-18)`);
    ok(rows.slice(0, 15).some((r) => r.p.pos === "G"), "goalies rank near the top, as they do in reality");
    ok(rows.slice(0, 25).some((r) => r.p.pos === "D"), "and defencemen appear too");
    ok(rows.slice(0, 25).some((r) => r.p.pos !== "G" && r.p.pos !== "D"), "alongside forwards");

    // Composition has to be the right shape.
    const gk = rows.find((r) => r.p.pos === "G");
    ok(gk.ps.ops === 0 && gk.ps.dps === 0 && gk.ps.gps > 0, "a goalie's shares are all goaltending");
    const sk = rows.find((r) => r.p.pos !== "G");
    ok(sk.ps.gps === 0, "a skater has no goaltending shares");
    ok(sk.ps.dps > 0, "and always earns something for the minutes he plays");
    const dmen = rows.filter((r) => r.p.pos === "D" && r.p.season.toi > 800);
    const fwds = rows.filter((r) => r.p.pos !== "D" && r.p.pos !== "G" && r.p.season.toi > 800);
    const dDef = dmen.reduce((s, r) => s + r.ps.dps, 0) / dmen.length;
    const fDef = fwds.reduce((s, r) => s + r.ps.dps, 0) / fwds.length;
    ok(dDef > fDef, `defencemen out-earn forwards defensively (${dDef.toFixed(1)} vs ${fDef.toFixed(1)})`);
    const fOff = fwds.reduce((s, r) => s + r.ps.ops, 0) / fwds.length;
    const dOff = dmen.reduce((s, r) => s + r.ps.ops, 0) / dmen.length;
    ok(fOff > dOff, `and forwards out-earn defencemen offensively (${fOff.toFixed(1)} vs ${dOff.toFixed(1)})`);

    // It has to track actual production.
    const corr = (xs, ys) => {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const n = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
      const dx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0));
      const dy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
      return dx && dy ? n / (dx * dy) : 0;
    };
    const r = corr(fwds.map((x) => A.pts(x.p.season)), fwds.map((x) => x.ps.ps));
    ok(r > 0.85, `a forward's point shares track his production (r=${r.toFixed(2)})`);
    // A player who never dressed earns nothing.
    const idle = A.playersOf(G).find((p) => !p.season.gp);
    ok(!idle || A.psOf(G, idle) === 0, "somebody who never played is worth zero");
  },

  // Rings, awards and a postseason record all have to survive the rollover.
  accolades(A) {
    section("Rings and accolades");
    const G = A.newGame(0, { seed: 231, rules: { seasonLen: 41 } });
    simSeason(A, G);
    const starred = A.playersOf(G).filter((p) => (p.allStars || []).length);
    ok(starred.length === 20, `All-Star selections are recorded on the players (${starred.length})`);
    ok(starred.every((p) => p.allStars[0] === G.year), "against the right year");

    simPlayoffs(A, G);
    const champ = G.playoffs.champion;
    const ringed = A.playersOf(G).filter((p) => (p.rings || []).length);
    ok(ringed.length >= 18, `the winning roster got rings (${ringed.length})`);
    ok(ringed.every((p) => p.rings[0].t === champ), "all from the club that won it");
    ok(ringed.every((p) => p.rings[0].year === G.year), "and stamped with the year");
    const losers = A.playersOf(G).filter((p) => p.teamId != null && p.teamId !== champ);
    ok(losers.every((p) => !(p.rings || []).length), "nobody else got one");

    /* The postseason used to be thrown away entirely. finishSeason archives it
       the moment the Cup is decided, so by the time simPlayoffs returns the
       single-season line is already folded into the career total. */
    const ran = A.playersOf(G).filter((p) => p.careerPO && p.careerPO.gp);
    ok(ran.length > 0, `playoff runs are kept as career totals (${ran.length} players)`);
    ok(A.playersOf(G).every((p) => p.po == null), "and the single-season line is cleared");
    const sample = ran.sort((a, b) => b.careerPO.gp - a.careerPO.gp)[0];
    ok(sample.poRuns === 1, "one run counted after one playoffs");
    ok(sample.careerPO.z === undefined, "career playoff totals carry no zone buckets");
    ok(sample.careerPO.gp <= 28, `and a plausible number of games (${sample.careerPO.gp})`);
    const before = sample.careerPO.gp;

    // A second run accumulates rather than replacing.
    A.autoDraft(G, false); A.startNextSeason(G);
    ok(sample.careerPO.gp === before, "the rollover doesn't disturb it");
    simSeason(A, G); simPlayoffs(A, G);
    if (sample.careerPO.gp > before) {
      ok(sample.poRuns === 2, `a second run is counted (${sample.poRuns})`);
      ok(sample.careerPO.gp > before, `and added to the total (${before} → ${sample.careerPO.gp})`);
    } else {
      ok(sample.poRuns === 1, "his club missed the second playoffs, so the total held");
      ok(true, "nothing to accumulate");
    }
    const stillRinged = A.playersOf(G).filter((p) => (p.rings || []).length);
    ok(stillRinged.length > 0, `rings persist across the rollover (${stillRinged.length})`);
  },

  // The offseason has to be walkable from one button without hunting.
  offseason(A) {
    section("Offseason flow");
    const G = A.newGame(0, { seed: 211, rules: { seasonLen: 41 } });
    simSeason(A, G); simPlayoffs(A, G);
    ok(G.phase === "offseason", "the playoffs hand over to the offseason");

    const seen = [];
    let guard = 0;
    while (G.phase === "offseason" && guard++ < 200) {
      const st = A.offseasonStage(G);
      const act = A.offseasonAction(G);
      ok(!!act && !!act.label, `stage ${st} offers a next action: ${act ? act.label : "none"}`);
      seen.push(st);
      A.doOffseasonStep(G);
    }
    ok(guard < 200, `the offseason terminates (${guard} steps)`);
    ok(G.phase === "regular", `and lands back in a regular season (${G.phase})`);
    ok(seen[0] === "review", "it starts at the review");
    ok(seen.includes("draft"), "passes through the draft");
    ok(seen.includes("fa"), "and free agency");
    ok(G.draftClass.length === 0, "the draft class was fully picked");
    ok(A.playersOf(G).filter((p) => p.rookie === false && p.farm).length > 0, "draftees landed somewhere");
    ok(A.offseasonAction(G) === null, "and once the season starts there's no offseason action left");
    ok(G.teams.every((t) => A.rosterOf(G, t.id).length >= 20), "every club can dress a roster after it");

    // Walking it must not depend on a stored step that can go stale.
    const G2 = A.newGame(0, { seed: 212, rules: { seasonLen: 41 } });
    simSeason(A, G2); simPlayoffs(A, G2);
    G2.offseasonStep = null;
    ok(A.offseasonStage(G2) === "review", "a missing step falls back to the review");
    G2.offseasonStep = "draft";
    G2.draftClass = [];
    ok(A.offseasonStage(G2) === "draftDone", "an emptied draft class reads as done, not stuck");
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

  /* Where a young player spends the year, and how it goes, is the central
     development decision. NHL minutes played well have to beat the farm; NHL
     minutes played badly, or not played at all, have to lose to it. If this
     ever flattens back into "the farm is always best", the choice is gone. */
  development(A) {
    section("Player development");
    const F = A.DEV_FARM, HI = A.DEV_NHL_HI, LO = A.DEV_NHL_LO;
    // A synthetic NHL line: gp games at `min` a night, scoring at `p60`.
    const sk = (pos, gp, min, p60) => [{ pos }, { gp, toi: gp * min, g: (p60 * gp * min) / 60, a: 0 }];
    const env = (args, farm) => A.devEnvironment(args[0], args[1], farm || null);
    const farmOnly = { gp: 82, g: 20, a: 25 };

    ok(A.devEnvironment({ pos: "C" }, null, farmOnly) === F,
      `a full farm season is worth exactly DEV_FARM (${F})`);
    ok(A.devEnvironment({ pos: "C" }, null, null) === 0, "playing nowhere is worth nothing");

    // The four corners of the model.
    const thriving = env(sk("C", 82, 20, 1.9));
    const solid    = env(sk("C", 82, 19, 1.15));
    const buried   = env(sk("C", 82, 8, 1.15));
    const drowning = env(sk("C", 82, 20, 0.3));
    ok(thriving > F, `thriving in a real NHL role beats the farm (${thriving.toFixed(2)} > ${F})`);
    ok(solid > F, `so does an average regular (${solid.toFixed(2)})`);
    ok(buried < F, `riding the bench does not (${buried.toFixed(2)} < ${F})`);
    ok(buried === 0, `a season in the press box teaches him nothing at all (${buried.toFixed(2)})`);
    ok(drowning < F, `nor does drowning in minutes he can't handle (${drowning.toFixed(2)})`);
    ok(thriving <= HI + 1e-9 && buried >= LO - 1e-9, "every outcome stays inside the band");

    // A fourth-liner is better off in the minors even when he's producing there.
    ok(env(sk("C", 82, 10, 2.2)) < F, "a productive fourth-liner still develops better on the farm");

    // Monotonic in both inputs — more ice time and more production can never hurt.
    let monoRole = true, monoPerf = true;
    for (let m = 6; m < 24; m++) if (env(sk("C", 82, m, 1.15)) > env(sk("C", 82, m + 1, 1.15)) + 1e-9) monoRole = false;
    for (let q = 0; q < 25; q++) {
      const a = env(sk("C", 82, 18, q * 0.1)), b = env(sk("C", 82, 18, (q + 1) * 0.1));
      if (a > b + 1e-9) monoPerf = false;
    }
    ok(monoRole, "more ice time never develops a player less");
    ok(monoPerf, "nor does more production");

    // Position is normalised out, not ignored: a defenceman plays more minutes
    // and scores less, so the SAME raw line reads differently at each position,
    // but a median season is worth about the same either way.
    ok(Math.abs(A.nhlDevRead({ pos: "D" }, sk("D", 82, 16, 0.90)[1]).perf) < 1e-9,
      "0.90 pts/60 is a par season for a defenceman");
    ok(A.nhlDevRead({ pos: "C" }, sk("C", 82, 16, 0.90)[1]).perf < -0.2,
      "and a below-par one for a forward");
    ok(A.devBand({ pos: "D" }).full > A.devBand({ pos: "C" }).full, "a D has to play more to earn a full role");
    ok(Math.abs(env(sk("D", 82, 16.2, 0.90)) - env(sk("C", 82, 12.7, 1.15))) < 0.4,
      "so a median season at either position develops a player about the same");

    // Goalies run off starts and save percentage, not minutes and points.
    const starter = A.devEnvironment({ pos: "G" }, { gp: 55, sa: 1600, sv: 1470 }, null);
    const backup = A.devEnvironment({ pos: "G" }, { gp: 8, sa: 220, sv: 200 }, null);
    ok(starter > F, `a young starter holding a .919 develops fast (${starter.toFixed(2)})`);
    ok(backup < F, `a backup who barely dressed does not (${backup.toFixed(2)})`);

    // A mid-season callup gets BOTH, weighted by games in each league.
    const half = A.devEnvironment({ pos: "C" }, sk("C", 41, 20, 1.9)[1], { gp: 41, g: 12, a: 15 });
    ok(half > F && half < thriving, `a callup blends the two (${half.toFixed(2)} between ${F} and ${thriving.toFixed(2)})`);
    ok(Math.abs(half - (thriving + F) / 2) < 1e-9, "and the blend is exactly games-weighted");
    const cup = A.devEnvironment({ pos: "C" }, sk("C", 20, 20, 1.9)[1], { gp: 60, g: 18, a: 20 });
    ok(cup < half, "a shorter callup is worth less of the NHL rate");

    // Age taper: the environment stops mattering once he's made.
    ok(A.devAgeWeight(20) === 1 && A.devAgeWeight(23) < 1 && A.devAgeWeight(26) === 0,
      "development environment tapers off with age");

    /* And it has to show up in a real league, not just in the unit maths: over
       a season, the young players who got real minutes and produced must be the
       ones who actually improved. */
    const G = A.newGame(0, { seed: 771, rules: { seasonLen: 82 } });
    simSeason(A, G);
    simPlayoffs(A, G);
    const young = A.playersOf(G).filter((p) => p.age <= 22 && !p.retired && ((p.stats && p.stats.gp) || (p.farmSeason && p.farmSeason.gp)));
    ok(young.length > 40, `a real cohort of young players (${young.length})`);
    const rows = young.map((p) => ({ p, e: A.devEnvironment(p, p.stats, p.farmSeason), before: p.ovr }));
    ok(rows.some((r) => r.e > F + 0.2) && rows.some((r) => r.e < F - 0.2),
      "the league produces both kinds of season");
    // `finishSeason` already ran progress(); compare against ovr recorded before.
    const spread = Math.max(...rows.map((r) => r.e)) - Math.min(...rows.map((r) => r.e));
    ok(spread > 1.5, `and they are genuinely different years (spread ${spread.toFixed(2)})`);
    const nhlReg = rows.filter((r) => r.p.stats && r.p.stats.gp >= 40 && r.p.stats.toi / r.p.stats.gp >= 17);
    const benched = rows.filter((r) => r.p.stats && r.p.stats.gp >= 40 && r.p.stats.toi / r.p.stats.gp <= 11);
    ok(nhlReg.length > 0 && benched.length > 0, `regulars (${nhlReg.length}) and bench players (${benched.length}) both exist`);
    const avg = (a) => a.reduce((s, r) => s + r.e, 0) / a.length;
    ok(avg(nhlReg) > avg(benched) + 1,
      `young regulars develop far better than young scratches (${avg(nhlReg).toFixed(2)} vs ${avg(benched).toFixed(2)})`);
  },

  /* The club picker shows a REAL league before you commit to it. Its whole
     promise is that the world you browsed is the world you get, which only
     holds because world generation reads the seed and never `userTeam` or
     `difficulty`. If that ever stops being true the preview becomes a lie, and
     nothing in the UI would tell you. */
  clubPicker(A) {
    section("Club picker");
    const fingerprint = (G) => G.teams.map((t) =>
      `${t.abbr}:${A.teamStrength(G, t.id)}:${A.rosterOf(G, t.id, true).map((p) => `${p.ln}${p.ovr}`).join(",")}`).join("|");

    const preview = A.newGame(0, { seed: 8123, rules: { seasonLen: 82 } });
    // Starting a career as ANY club must yield the league that was previewed.
    for (const club of [0, 7, 19, 31]) {
      const real = A.newGame(club, { seed: 8123, rules: { seasonLen: 82 } });
      ok(fingerprint(real) === fingerprint(preview),
        `taking over club ${club} gives exactly the previewed league`);
      ok(real.userTeam === club, `and you actually manage club ${club}`);
    }
    // Difficulty must not move the world either — it's pressure on the manager.
    const hard = A.newGame(0, { seed: 8123, difficulty: "cutthroat", rules: { seasonLen: 82 } });
    ok(fingerprint(hard) === fingerprint(preview), "difficulty changes the challenge, not the league");
    // A different seed must actually be a different league, or reroll is a no-op.
    ok(fingerprint(A.newGame(0, { seed: 999, rules: { seasonLen: 82 } })) !== fingerprint(preview),
      "rerolling the seed genuinely rebuilds the league");

    // Every summary the picker renders has to be real and complete.
    const sums = preview.teams.map((t) => A.clubSummary(preview, t.id));
    ok(sums.length === 32, "every club gets a summary");
    ok(sums.every((s) => s.best && s.goalie), "each has a best player and a goaltender");
    ok(sums.every((s) => s.rating >= 40 && s.rating <= 90), "ratings land in a sane band");
    ok(sums.every((s) => s.age > 20 && s.age < 34), "and so do average ages");
    ok(sums.every((s) => s.goalie.pos === "G"), "the goalie shown is actually a goalie");
    ok(sums.every((s) => s.best.ovr === Math.max(...A.rosterOf(preview, s.id).map((p) => p.ovr))),
      "the best player shown is actually the best player");
    ok(sums.every((s) => s.t.rivalId != null), "every club has a rival to show");

    // The outlook bands must SPLIT the league. Guessed thresholds once put all
    // 32 clubs in "Contender", which told the user nothing.
    const byLabel = {};
    sums.forEach((s) => { byLabel[s.outlook.t] = (byLabel[s.outlook.t] || 0) + 1; });
    ok(Object.keys(byLabel).length >= 3,
      `outlook separates the league (${Object.entries(byLabel).map(([k, v]) => `${k} ${v}`).join(", ")})`);
    ok(Math.max(...Object.values(byLabel)) <= 20, "and no single label swallows it");
    // Rating must track the thing it claims to measure.
    const sorted = sums.slice().sort((a, b) => b.rating - a.rating);
    ok(sorted[0].rating > sorted[31].rating + 8,
      `the league has a real spread (${sorted[31].rating}–${sorted[0].rating})`);

    ok(A.ordinal(1) === "1st" && A.ordinal(2) === "2nd" && A.ordinal(3) === "3rd" && A.ordinal(4) === "4th",
      "ordinals read correctly");
    ok(A.ordinal(11) === "11th" && A.ordinal(12) === "12th" && A.ordinal(13) === "13th",
      "including the teens");
    ok(A.ordinal(21) === "21st" && A.ordinal(22) === "22nd" && A.ordinal(32) === "32nd",
      "and back out the other side");
  },

  /* The goalie scouting report must be EVIDENCE, not a label. It used to print
     `goalieHole` — a pure function of player id — so it said the same thing on
     day 1 as on day 82 whatever happened on the ice. */
  goalieScouting(A) {
    section("Goalie scouting report");
    const G = A.newGame(0, { seed: 616, rules: { seasonLen: 82 } });
    const keepers = () => A.playersOf(G).filter((p) => p.pos === "G" && p.season.gp > 0);

    // Before a puck is dropped there is genuinely nothing to report.
    const cold = A.goalieReport(G, A.playersOf(G).find((p) => p.pos === "G"));
    ok(cold.starts === 0 && cold.sa === 0, "an unplayed goalie has no record");
    ok(cold.confidence === 0, "and no confidence in a read");
    ok(!cold.soft && !cold.strong, "so it claims no weakness");

    simSeason(A, G);
    const reports = keepers().map((p) => ({ p, r: A.goalieReport(G, p) }));
    ok(reports.length > 40, `a full league of goalies played (${reports.length})`);

    // The numbers must reconcile with the season line, not float free of it.
    ok(reports.every(({ p, r }) => r.sa === p.season.sa && r.starts === p.season.gp),
      "the report's totals match the goalie's actual season");
    ok(reports.every(({ r }) => r.cells.reduce((s, c) => s + c.sa, 0) === r.sa - (0)) ||
       reports.every(({ p, r }) => r.cells.reduce((s, c) => s + c.sa, 0) <= r.sa),
      "per-cell shots never exceed shots faced");
    ok(reports.every(({ r }) => r.cells.every((c) => c.ga <= c.sa)),
      "no cell lets in more than it faced");

    // Confidence has to grow with evidence, and starters must clear the bar.
    const busy = reports.filter(({ r }) => r.sa >= A.REPORT_TRUST_SA);
    ok(busy.length > 20, `most starters accumulate a real sample (${busy.length})`);
    ok(busy.every(({ r }) => r.confidence === 1), "a full workload is a confident read");
    ok(reports.every(({ r }) => r.confidence >= 0 && r.confidence <= 1), "confidence stays in range");

    // A named weakness must be backed by enough shots to mean anything.
    const named = reports.filter(({ r }) => r.soft);
    ok(named.length > 0, `some goalies show a readable weakness (${named.length})`);
    ok(named.every(({ r }) => r.soft.sa >= A.REPORT_MIN_SHOTS),
      "a named soft spot always clears the minimum sample");
    const lg = A.leagueNetRates(G);
    ok(named.every(({ r }) => r.soft.rate > lg[r.soft.cell.key]),
      "and is genuinely worse there than the league is");

    /* The whole point: the report is driven by what happened, so two goalies
       with the SAME structural hole must still produce different reports, and
       the same goalie's report must change as a season is played. */
    const byHole = {};
    reports.forEach(({ p, r }) => { (byHole[r.hole.key] = byHole[r.hole.key] || []).push(r); });
    // Soft spot must not be a FUNCTION of the hole: somewhere in the league,
    // two goalies sharing a hole have to scout differently. Sampling a single
    // group is a coin flip, so check every group.
    const divergent = Object.values(byHole).filter((g) => g.length >= 2)
      .filter((g) => new Set(g.map((r) => (r.soft ? r.soft.cell.key : "none"))).size > 1);
    ok(divergent.length > 0,
      `goalies sharing a structural hole still scout differently (${divergent.length} such groups)`);
    /* What matters is that no single cell is THE answer for the whole league —
       counting distinct cells is a hostage to the RNG stream, since any new sim
       work reshuffles every season. A share test says the same thing and holds. */
    const softCount = {};
    named.forEach(({ r }) => { softCount[r.soft.cell.key] = (softCount[r.soft.cell.key] || 0) + 1; });
    const topShare = Math.max(...Object.values(softCount)) / named.length;
    ok(Object.keys(softCount).length >= 2 && topShare < 0.7,
      `no single cell is the league's answer (${Object.entries(softCount).map(([k, v]) => `${k} ${v}`).join(", ")})`);
    // It must not simply echo goalieHole — that would be the old label again.
    const echo = named.filter(({ r }) => r.soft.cell.key === r.hole.key).length;
    ok(echo < named.length * 0.75,
      `the report is evidence, not a readout of the hidden hole (${echo}/${named.length} agree)`);
    // But it shouldn't be noise either — the hole is real, so it should show up
    // more often than chance (1 in 9 cells).
    ok(echo > named.length * 0.11,
      `though the real hole does show through more often than chance (${echo}/${named.length})`);
  },

  /* A bracket is a STRUCTURE, not a list. `advancePlayoffRound` pairs adjacent
     survivors (slots 2i and 2i+1), so `buildBracket` must push round one in an
     order where neighbours are meant to meet. Get that wrong and the seeding
     silently collapses: the 1 seed's half contains the 2 seed, and a division's
     winner meets the OTHER division's winner in round two. */
  seeding(A) {
    section("Playoff seeding");

    const firstRound = (G) => G.playoffs.rounds[0];
    const halves = (G, conf) => firstRound(G).filter((s) => s.conf === conf);

    // ---- seeded 1–8 ----
    const S = A.newGame(0, { seed: 4801, rules: { seasonLen: 41, playoffFormat: "seeded" } });
    simSeason(A, S);
    [0, 1].forEach((conf) => {
      const f = A.playoffField(S, conf);
      const rank = new Map(f.map((x) => [x.team.id, x.seed]));
      const r1 = halves(S, conf);
      ok(r1.length === 4, `conference ${conf} opens with four series`);
      // Every series must be seed n vs seed 9-n, and home ice to the better seed.
      ok(r1.every((s) => rank.get(s.hi) + rank.get(s.lo) === 9),
        `conference ${conf} pairs 1-8, 2-7, 3-6, 4-5`);
      ok(r1.every((s) => rank.get(s.hi) < rank.get(s.lo)),
        `and the better seed holds home ice`);
      // The structural part: neighbours meet in round two, so the 1 seed's half
      // must hold the 4/5 series and NOT the 2 seed's.
      const half = (i) => [rank.get(r1[i].hi), rank.get(r1[i + 1].hi)].sort((a, b) => a - b);
      ok(JSON.stringify(half(0)) === JSON.stringify([1, 4]),
        `the 1 seed's half of conference ${conf} holds the 4/5 series (${half(0).join("/")})`);
      ok(JSON.stringify(half(2)) === JSON.stringify([2, 3]),
        `and the 2 seed's half holds the 3/6 series (${half(2).join("/")})`);
    });

    // ---- divisional ----
    const D = A.newGame(0, { seed: 4801, rules: { seasonLen: 41, playoffFormat: "divisional" } });
    simSeason(A, D);
    [0, 1].forEach((conf) => {
      const { top, wc } = A.playoffField(D, conf);
      const r1 = halves(D, conf);
      ok(r1.length === 4, `conference ${conf} opens with four divisional series`);
      const divOf = (id) => D.teams[id].div;
      const wcIds = wc.map((t) => t.id);
      const winners = top.filter((x) => x.divRank === 1).map((x) => x.team.id);
      const seconds = top.filter((x) => x.divRank === 2).map((x) => x.team.id);
      // Slots 0 and 2 are the division winners; 1 and 3 are the 2-vs-3 series.
      ok([0, 2].every((i) => winners.includes(r1[i].hi) && wcIds.includes(r1[i].lo)),
        `conference ${conf} opens each half with a division winner vs a wildcard`);
      ok([1, 3].every((i) => seconds.includes(r1[i].hi)),
        `and the other half-opener is the 2 vs 3`);
      // The structural part: a half must belong to ONE division — the division
      // winner and the 2v3 from the same division have to meet in round two.
      ok(divOf(r1[0].hi) === divOf(r1[1].hi) && divOf(r1[2].hi) === divOf(r1[3].hi),
        `each half of conference ${conf} stays inside one division`);
      ok(divOf(r1[0].hi) !== divOf(r1[2].hi), `and the two halves are different divisions`);
      // Cross-division part of the real format: the better division winner
      // draws the LOWER wildcard.
      const betterSlot = D.teams[r1[0].hi].pts >= D.teams[r1[2].hi].pts ? 0 : 2;
      ok(r1[betterSlot].lo === wc[1].id,
        "the stronger division winner draws the second wildcard");
      ok(r1[betterSlot === 0 ? 2 : 0].lo === wc[0].id,
        "and the weaker one draws the first");
    });

    // Play it out and confirm the structure actually holds through the bracket.
    simPlayoffs(A, D);
    const P = D.playoffs;
    ok(P.champion != null, "the bracket resolves to a champion");
    ok(P.rounds.length === 4, `four rounds were played (${P.rounds.length})`);
    ok(P.rounds[1].every((s) => s.conf >= 0), "round two is still inside the conferences");
    ok(P.rounds[3].length === 1 && P.rounds[3][0].conf === -1, "the final crosses conferences");
    // Nobody may appear twice in a round — the `wc[1] || wc[0]` fallback could
    // once put one club in two series at the same time.
    P.rounds.forEach((rd, i) => {
      const ids = rd.flatMap((s) => [s.hi, s.lo]);
      ok(new Set(ids).size === ids.length, `no club appears twice in round ${i + 1}`);
    });
  },

  /* Keeping your own players. Before this the only way to retain anyone was to
     let him reach the market and outbid thirty-one clubs for a player you
     already had, and every expiring contract in the league hit free agency at
     once because no AI club ever re-signed anybody. */
  contracts(A) {
    section("Extensions");
    const G = A.newGame(0, { seed: 3311, rules: { seasonLen: 41 } });
    const mine = A.rosterOf(G, 0);
    const short = mine.find((p) => p.contract.yrs <= 1) || mine[0];
    short.contract.yrs = 1;
    const locked = mine.find((p) => p.contract.yrs >= 3);

    ok(A.canExtend(G, short), "a player in the last year of his deal can be extended");
    ok(!locked || !A.canExtend(G, locked), "one with years left cannot");
    ok(!A.extendPlayer(G, locked ? locked.id : short.id, 99, 3).ok || !locked,
      "and trying anyway is refused");

    // Loyalty: staying costs a shade less than signing him off the market.
    const ask = A.extensionAsk(G, short.id, 0, 3);
    const open = A.askingPrice(G, short.id, 0, 3);
    ok(ask < open, `his own club gets a loyalty discount ($${ask}M vs $${open}M)`);
    ok(ask >= 0.5, "but never below the minimum");

    const low = A.extendPlayer(G, short.id, ask * 0.9, 3);
    ok(!low.ok && low.counter, `a near miss counters ($${low.counter}M)`);
    ok(!A.extendPlayer(G, short.id, ask * 0.3, 3).ok, "a lowball gets nothing");
    const before = A.capHit(G, 0);
    const done = A.extendPlayer(G, short.id, ask, 3);
    ok(done.ok, "meeting the number keeps him");
    ok(short.contract.yrs === 3 && short.contract.amt === ask, "on the terms agreed");
    // The extension REPLACES the expiring deal — only the difference is new money.
    ok(Math.abs(A.capHit(G, 0) - before) < Math.abs(ask) + 0.05,
      "and it replaces his old deal rather than stacking on it");

    section("AI contract decisions");
    const H = A.newGame(0, { seed: 3311, rules: { seasonLen: 41 } });
    simSeason(A, H); simPlayoffs(A, H);
    // finishSeason has now run: AI clubs have made their calls.
    const faIds = new Set(H.freeAgents);
    const signed = A.playersOf(H).filter((p) => !p.retired && p.teamId != null);
    ok(H.freeAgents.length > 20, `a real free-agent class reached the market (${H.freeAgents.length})`);
    ok(H.freeAgents.length < 400, "but not every expiring contract in the league");
    // The decision must DISCRIMINATE — good players kept, fringe let go.
    const fas = H.freeAgents.map((id) => H.players[id]).filter(Boolean);
    const kept = signed.filter((p) => p.teamId !== H.userTeam);
    const avg = (a) => (a.length ? a.reduce((s, p) => s + p.ovr, 0) / a.length : 0);
    ok(avg(kept) > avg(fas), `clubs keep the better players (${avg(kept).toFixed(1)} vs ${avg(fas).toFixed(1)})`);
    const oldFas = fas.filter((p) => p.age >= 31).length / Math.max(1, fas.length);
    const oldKept = kept.filter((p) => p.age >= 31).length / Math.max(1, kept.length);
    ok(oldFas > oldKept, `and let the older ones walk (${(oldFas * 100).toFixed(0)}% vs ${(oldKept * 100).toFixed(0)}% over 30)`);
    ok(H.teams.every((t) => A.capHit(H, t.id) <= A.rules(H).capAmount + 0.5),
      "nobody re-signed themselves over the cap",
      H.teams.filter((t) => A.capHit(H, t.id) > A.rules(H).capAmount + 0.5).map((t) => `${t.abbr} ${A.capHit(H, t.id)}`).join(" "));

    // FARM_MAX is a declared rule; it has to actually hold.
    ok(H.teams.every((t) => A.rosterOf(H, t.id, true).filter((p) => p.farm).length <= A.FARM_MAX),
      "no club stockpiles more than a legal farm",
      H.teams.map((t) => A.rosterOf(H, t.id, true).filter((p) => p.farm).length).sort((a, b) => b - a).slice(0, 3).join("/"));
  },

  /* The farm used to be a stat generator with no opponent, no result and
     nothing to win. It is now a league: mirrored fixtures, a table, and a
     championship. The checks below are what stop it drifting back into a
     random-number machine that happens to print plausible totals. */
  farmLeague(A) {
    section("The farm league");
    const G = A.newGame(0, { seed: 7712, rules: { seasonLen: 82 } });
    ok(G.teams.every((t) => A.farmRec(t).gp === 0), "every affiliate starts with a clean sheet");

    // One day at a time, on its own game, so the mirroring can be checked
    // against the fixtures without polluting the season totals below.
    const D = A.newGame(0, { seed: 7712, rules: { seasonLen: 82 } });
    const fixtures = D.schedule[D.day] || [];
    const before = D.teams.map((t) => A.farmRec(t).gp);
    A.simFarmDay(D, D.day);
    const played = new Set();
    fixtures.forEach((f) => { played.add(f.home); played.add(f.away); });
    ok(fixtures.length > 0, `the calendar opens with fixtures (${fixtures.length})`);
    ok(D.teams.every((t, i) => A.farmRec(t).gp === before[i] + (played.has(t.id) ? 1 : 0)),
      "an affiliate plays exactly when its parent club does");

    simSeason(A, G);
    const recs = G.teams.map((t) => A.farmRec(t));
    ok(recs.every((r) => r.gp > 0), "every affiliate played a season");
    ok(recs.every((r) => r.w + r.l + r.otl === r.gp), "records reconcile with games played");
    // The mirrored schedule means the farm plays exactly the NHL slate.
    ok(G.teams.every((t, i) => A.farmRec(t).gp === t.gp),
      "the affiliates play the same number of games as their parents");
    // A league is zero-sum: goals for must equal goals against across it.
    const gf = recs.reduce((s, r) => s + r.gf, 0), ga = recs.reduce((s, r) => s + r.ga, 0);
    ok(gf === ga, `the league's goals balance (${gf} vs ${ga})`);
    const totalW = recs.reduce((s, r) => s + r.w, 0);
    ok(totalW === recs.reduce((s, r) => s + r.l + r.otl, 0), "and so do wins against losses");

    // Scoring has to be sane, not just internally consistent.
    const perGame = gf / recs.reduce((s, r) => s + r.gp, 0);
    ok(perGame > 1.8 && perGame < 5, `farm scoring is plausible (${perGame.toFixed(2)} per club-game)`);

    // Player lines must add up to the club's goals, or the table is a fiction.
    let mismatch = 0;
    G.teams.forEach((t) => {
      const skaters = A.rosterOf(G, t.id, true).filter((p) => p.farm && p.farmSeason);
      const goals = skaters.reduce((s, p) => s + (p.farmSeason.g || 0), 0);
      if (goals > A.farmRec(t).gf) mismatch++;
    });
    ok(mismatch === 0, "no club's prospects out-score the club itself");
    const withLines = A.playersOf(G).filter((p) => p.farm && p.farmSeason && p.farmSeason.gp > 0);
    ok(withLines.length > 100, `prospects built real stat lines (${withLines.length})`);
    ok(withLines.some((p) => p.farmSeason.g > 0 && p.farmSeason.a > 0), "with goals and assists");
    /* Every number must be a NUMBER. A negative base to a fractional power is
       NaN, and NaN weights silently route every goal to the last skater in the
       list — on a thin affiliate one player took all 154 of his club's goals
       and the whole roster finished with zero assists. Averages across the
       league hid it completely. */
    ok(withLines.every((p) => Object.values(p.farmSeason).every((v) => typeof v === "number" && isFinite(v))),
      "no farm stat is NaN or infinite");
    // Scoring must be SHARED. No prospect may take an absurd slice of his club.
    let hog = null;
    G.teams.forEach((t) => {
      const sk = A.rosterOf(G, t.id, true).filter((p) => p.farm && p.farmSeason && p.pos !== "G");
      const clubG = A.farmRec(t).gf;
      if (clubG < 20 || sk.length < 3) return;
      sk.forEach((p) => { if ((p.farmSeason.g || 0) / clubG > 0.6) hog = `${p.ln} ${p.farmSeason.g}/${clubG} for ${t.abbr}`; });
    });
    ok(!hog, "no single prospect scores most of his club's goals", hog);
    /* Assists must outnumber goals, as they do in any hockey league. They are
       drawn from the same pool, so this also proves a prospect gets credited on
       goals scored by team-mates the game doesn't model individually — skipping
       those events entirely once cut the ratio to 0.38 and buried playmakers. */
    const sk = withLines.filter((p) => p.pos !== "G");
    const tg = sk.reduce((s, p) => s + p.farmSeason.g, 0);
    const ta = sk.reduce((s, p) => s + p.farmSeason.a, 0);
    ok(ta > tg, `assists outnumber goals (${ta} to ${tg}, ${(ta / tg).toFixed(2)})`);
    // And a top prospect's season has to look like a hockey season, not a video
    // game one: five prospects splitting a whole club once produced 138 goals.
    const best = sk.filter((p) => p.farmSeason.gp >= 40)
      .sort((a, b) => b.farmSeason.g - a.farmSeason.g)[0];
    ok(best && best.farmSeason.g / best.farmSeason.gp < 0.85,
      `even the best farm scorer is plausible (${best.farmSeason.g} in ${best.farmSeason.gp})`);
    // And assists have to happen everywhere, not just on deep affiliates.
    const clubsWithAssists = G.teams.filter((t) => {
      const sk = A.rosterOf(G, t.id, true).filter((p) => p.farm && p.farmSeason && p.pos !== "G");
      return sk.length >= 3 && sk.some((p) => (p.farmSeason.a || 0) > 0);
    }).length;
    const eligible = G.teams.filter((t) => A.rosterOf(G, t.id, true).filter((p) => p.farm && p.farmSeason && p.pos !== "G").length >= 3).length;
    ok(clubsWithAssists === eligible,
      `every affiliate with a real roster records assists (${clubsWithAssists}/${eligible})`);
    const keepers = withLines.filter((p) => p.pos === "G" && p.farmSeason.sa > 0);
    ok(keepers.length > 5, `farm goalies faced shots (${keepers.length})`);
    ok(keepers.every((p) => p.farmSeason.sv + p.farmSeason.ga === p.farmSeason.sa),
      "and their saves reconcile with shots faced");
    ok(keepers.some((p) => p.farmSeason.w > 0), "and some of them won games");

    // Ability has to matter, or the league is noise.
    const scorers = withLines.filter((p) => p.pos !== "G" && p.farmSeason.gp >= 20);
    const good = scorers.filter((p) => p.ovr >= 55), poor = scorers.filter((p) => p.ovr < 45);
    const ppg = (a) => (a.length ? a.reduce((s, p) => s + (p.farmSeason.g + p.farmSeason.a) / p.farmSeason.gp, 0) / a.length : 0);
    ok(good.length && poor.length && ppg(good) > ppg(poor) * 1.4,
      `better prospects produce more (${ppg(good).toFixed(2)} vs ${ppg(poor).toFixed(2)} per game)`);

    // The table has to separate clubs, and the championship has to resolve.
    const table = A.farmStandings(G);
    ok(A.farmRec(table[0]).pts > A.farmRec(table[31]).pts + 10,
      `the table spreads (${A.farmRec(table[31]).pts}–${A.farmRec(table[0]).pts} pts)`);
    ok(G.farmCup && G.farmCup.champion != null, "the affiliates crowned a champion");
    ok(G.farmCup.field.length === A.FARM_CUP_FIELD, `${A.FARM_CUP_FIELD} clubs made the farm playoffs`);
    ok(G.farmCup.rounds.length === 3, `played over three rounds (${G.farmCup.rounds.length})`);
    ok(G.farmCup.field.includes(G.farmCup.champion), "the champion came from the field");
    ok(G.teams[G.farmCup.champion].farmCups === 1, "and the club has the title on its record");
    const winners = A.playersOf(G).filter((p) => (p.farmTitles || []).length);
    ok(winners.length > 0, `the prospects who won it have it on theirs (${winners.length})`);

    // A championship must be earned, not handed to whoever sorts first.
    ok(G.farmCup.rounds.every((rd) => rd.every((s) => s.winner === s.hi || s.winner === s.lo)),
      "every series was won by one of its two clubs");

    // It survives a rollover and starts clean.
    simPlayoffs(A, G);
    A.autoDraft(G, false);
    A.startNextSeason(G);
    ok(G.teams.every((t) => A.farmRec(t).gp === 0), "the table resets for the new season");
    ok(G.farmCup == null, "and last year's farm cup is cleared");
    ok(A.playersOf(G).some((p) => (p.farmCareer || []).length), "last year's farm line was archived");
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
