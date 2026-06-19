#!/usr/bin/env node
'use strict';

/**
 * token-watch report.
 *
 * Usage:
 *   node report.js            # summary: today, last 7 days, all-time
 *   node report.js today      # only today
 *   node report.js sessions   # per-session breakdown (last 15)
 *   node report.js models     # cost grouped by model
 *
 * Data sources:
 *   - ~/.claude/token-watch/usage.jsonl  (durable per-session log)
 *   - live transcripts                   (fills in the current session
 *                                          before SessionEnd has fired)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { colors, humanNumber, usd } = require('../lib/format');
const { readTranscript, aggregate, allTranscripts } = require('../lib/transcript');
const { getUsage } = require('../lib/usage-api');

const { bold, cyan, green, dim, gray, yellow } = colors;

function loadLog() {
  const f = path.join(os.homedir(), '.claude', 'token-watch', 'usage.jsonl');
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip */ }
  }
  return out;
}

/** Build session records from live transcripts, keyed by session id. */
function liveSessions() {
  const map = new Map();
  for (const f of allTranscripts()) {
    const id = path.basename(f.file, '.jsonl');
    if (map.has(id)) continue;
    const t = aggregate(readTranscript(f.file));
    if (t.messages === 0) continue;
    map.set(id, {
      ts: new Date(f.mtime).toISOString(),
      session: id,
      cwd: f.project,
      ...t,
    });
  }
  return map;
}

/** Merge durable log with live transcripts (live wins for same session). */
function mergedSessions() {
  const map = new Map();
  for (const e of loadLog()) map.set(e.session, e);
  for (const [id, e] of liveSessions()) map.set(id, e); // live is fresher
  const ms = (x) => (x && x.ts ? new Date(x.ts).getTime() || 0 : 0);
  return [...map.values()].sort((a, b) => ms(b) - ms(a));
}

function sumDay(sessions, isoDay) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };
  for (const s of sessions) {
    if (!s.ts || !s.ts.startsWith(isoDay)) continue;
    t.input += s.input || 0;
    t.output += s.output || 0;
    t.cacheRead += s.cacheRead || 0;
    t.cacheWrite += s.cacheWrite || 0;
    t.cost += s.cost || 0;
    t.messages += s.messages || 0;
  }
  return t;
}

function totalsLine(t) {
  return (
    `${green(usd(t.cost))}  ` +
    gray(
      `${t.messages} msg · ⬆${humanNumber(t.input)} ⬇${humanNumber(t.output)} ` +
      `· cache ${humanNumber(t.cacheRead)}r/${humanNumber(t.cacheWrite)}w`
    )
  );
}

function head(s) { return '\n' + bold(cyan(s)); }

/**
 * Aggregate all session records whose timestamp falls within [cutoff, now].
 * Returns totals: { input, output, cacheRead, cacheWrite, cost, messages }.
 */
function rollingWindow(sessions, cutoffMs) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };
  for (const s of sessions) {
    const ts = s.ts ? new Date(s.ts).getTime() || 0 : 0;
    if (ts < cutoffMs) continue;
    t.input    += s.input    || 0;
    t.output   += s.output   || 0;
    t.cacheRead  += s.cacheRead  || 0;
    t.cacheWrite += s.cacheWrite || 0;
    t.cost     += s.cost     || 0;
    t.messages += s.messages || 0;
  }
  return t;
}

/**
 * Format a rolling-window total with an optional cap.
 * If cap is set: "x / cap (y%)"
 * Otherwise: just the token count.
 */
function windowLine(t, capEnvVar) {
  const cap = parseInt(process.env[capEnvVar], 10);
  const totalTok = t.input + t.output + t.cacheRead + t.cacheWrite;
  let tokStr;
  if (!isNaN(cap) && cap > 0) {
    const pct = Math.round((totalTok / cap) * 100);
    tokStr = gray(humanNumber(totalTok) + ' / ' + humanNumber(cap) + ' (' + pct + '%)');
  } else {
    tokStr = gray(humanNumber(totalTok) + dim(' tokens'));
  }
  return green(usd(t.cost)) + '  ' + tokStr + '  ' + gray(t.messages + ' msg');
}

async function main() {
  const mode = (process.argv[2] || 'summary').toLowerCase();
  const sessions = mergedSessions();

  if (sessions.length === 0) {
    console.log(yellow('token-watch: no usage recorded yet.'));
    console.log(dim('Run a Claude Code session, then try /token-report again.'));
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  if (mode === 'sessions') {
    console.log(head('Recent sessions'));
    for (const s of sessions.slice(0, 15)) {
      const when = (s.ts || '').replace('T', ' ').slice(0, 16);
      console.log(`${gray(when)}  ${green(usd(s.cost || 0))}  ${dim(String(s.cwd || '').slice(0, 40))}`);
    }
    return;
  }

  if (mode === 'models') {
    const byModel = {};
    for (const s of sessions) {
      for (const [m, cost] of Object.entries(s.models || {})) {
        byModel[m] = (byModel[m] || 0) + cost;
      }
    }
    console.log(head('Cost by model (all time)'));
    const rows = Object.entries(byModel).sort((a, b) => b[1] - a[1]);
    for (const [m, cost] of rows) {
      console.log(`  ${green(usd(cost).padEnd(10))} ${m.replace(/^claude-/, '')}`);
    }
    return;
  }

  // summary (default) or today
  const day = sumDay(sessions, today);
  console.log(head('Today  ' + dim('(' + today + ')')));
  console.log('  ' + totalsLine(day));

  if (mode === 'today') return;

  // last 7 days
  const week = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };
  const cutoff = Date.now() - 7 * 86400_000;
  for (const s of sessions) {
    const t = s.ts ? new Date(s.ts).getTime() || 0 : 0;
    if (t < cutoff) continue;
    week.input += s.input || 0; week.output += s.output || 0;
    week.cacheRead += s.cacheRead || 0; week.cacheWrite += s.cacheWrite || 0;
    week.cost += s.cost || 0; week.messages += s.messages || 0;
  }
  console.log(head('Last 7 days'));
  console.log('  ' + totalsLine(week));

  // all time
  const all = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };
  for (const s of sessions) {
    all.input += s.input || 0; all.output += s.output || 0;
    all.cacheRead += s.cacheRead || 0; all.cacheWrite += s.cacheWrite || 0;
    all.cost += s.cost || 0; all.messages += s.messages || 0;
  }
  console.log(head('All time  ' + dim('(' + sessions.length + ' sessions)')));
  console.log('  ' + totalsLine(all));

  // Subscription windows — prefer real API data if available
  const apiUsage = await getUsage().catch(() => null);
  console.log(head('Subscription windows'));

  if (apiUsage && (apiUsage.session5hPct !== null || apiUsage.weekly7dPct !== null)) {
    // Real data from Anthropic API
    if (apiUsage.session5hPct !== null) {
      const pct5h = Math.round(apiUsage.session5hPct * 100);
      const resets5h = apiUsage.resetsSession
        ? dim('  resets ' + new Date(apiUsage.resetsSession).toLocaleTimeString())
        : '';
      console.log('  ' + dim('5h   real:    ') + cyan(pct5h + '%') + resets5h);
    }
    if (apiUsage.weekly7dPct !== null) {
      const pct7d = Math.round(apiUsage.weekly7dPct * 100);
      const resets7d = apiUsage.resetsWeekly
        ? dim('  resets ' + new Date(apiUsage.resetsWeekly).toLocaleDateString())
        : '';
      console.log('  ' + dim('7d   real:    ') + cyan(pct7d + '%') + resets7d);
    }
    console.log('  ' + dim('Source: api.anthropic.com/api/oauth/usage (live)'));
  } else {
    // API unavailable — no heuristic fallback. Show a clear error only.
    console.log(
      '  ' + dim('⚠  API live unavailable (network/TLS/auth error). No subscription data shown.')
    );
    console.log(
      '  ' + dim('   Run with TOKEN_WATCH_TLS_STRICT=0 to allow unverified TLS (corporate proxy),')
    );
    console.log(
      '  ' + dim('   or check your credentials (~/.claude/.credentials.json) and network.')
    );
  }

  console.log('');
  console.log(dim('Tip: /token-report sessions · /token-report models · /token-report today'));
}

main().catch((e) => {
  console.error('token-watch report error:', e.message);
  process.exit(1);
});
