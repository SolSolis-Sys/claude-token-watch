#!/usr/bin/env node
'use strict';

/**
 * Tests for the 5h quota alert (quota_alert_pct, default 90 %).
 *
 * Zero framework, ZERO child process: the sandbox refuses piped spawn, so the
 * hook is exercised in-process through the `run()` export of hooks/loop-advisor.js.
 *
 * HOME/USERPROFILE is redirected to a temp dir BEFORE the modules are required,
 * so the real ~/.claude/ is never read or written.
 *
 * Run: node test/quota-alert.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

// --- Temporary HOME (must happen before requiring anything homedir-based) ---
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-quota-home-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
delete process.env.TOKEN_WATCH_QUOTA_ALERT_PCT;
delete process.env.TOKEN_WATCH_LOOP_PCT;
delete process.env.TOKEN_WATCH_LOOP_ADVISOR;

const TW_DIR     = path.join(HOME, '.claude', 'token-watch');
const CACHE_FILE = path.join(TW_DIR, 'usage-cache.json');
const STATE_FILE = path.join(TW_DIR, 'loop-advisor-last.json');
const CONFIG_FILE = path.join(TW_DIR, 'config.yaml');
const CONFIG_JSON_FILE = path.join(TW_DIR, 'config.json');
fs.mkdirSync(TW_DIR, { recursive: true });

const api      = require('../lib/usage-api');
const { loadConfig } = require('../lib/config');

// Requiring the hook must neither run it nor kill this process: the CLI entry
// point is `require.main === module`, so `process.exit()` at require time means
// the hook body ran (the pre-fix pathology that made it silently mute the test).
let advisor;
(function requireHookWithoutRunningIt() {
  const realExit = process.exit;
  let exitCalls = 0;
  process.exit = () => {
    exitCalls++;
    throw new Error('hooks/loop-advisor.js called process.exit() while being required');
  };
  try {
    advisor = require('../hooks/loop-advisor');
  } finally {
    process.exit = realExit;
  }
  if (exitCalls > 0) throw new Error('hook must not exit at require time');
})();

if (typeof advisor.run !== 'function') {
  throw new Error('hooks/loop-advisor.js must export run(input) for in-process checks');
}

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  OK ' + name);
}

const DEFAULT_THRESHOLD = 90;

function writeCache(obj) {
  fs.writeFileSync(CACHE_FILE, typeof obj === 'string' ? obj : JSON.stringify(obj));
}
function cacheAt(pct, resetsSession) {
  return {
    data: { session5hPct: pct, weekly7dPct: 0.2, resetsSession: resetsSession || null, resetsWeekly: null },
    fetchedAt: Date.now(),
    failCount: 0,
    nextRetryAt: 0,
  };
}
function clearCache() { fs.rmSync(CACHE_FILE, { force: true }); }
function clearState() { fs.rmSync(STATE_FILE, { force: true }); }
function setEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log('\nquota-alert test (5h quota threshold)\n');

// ── Guard: everything resolves under the temp HOME ────────────────────────────
ok('usage cache and state file resolve under the temporary HOME', () => {
  assert.strictEqual(api.CACHE_FILE, CACHE_FILE, 'usage cache must live in the temp HOME');
  assert.ok(CACHE_FILE.startsWith(HOME), 'temp HOME not honoured');
  assert.ok(!CACHE_FILE.startsWith(path.join(os.homedir(), '.claude')) || CACHE_FILE.startsWith(HOME));
});

// ── 1. config: default 90, yaml override, env override ────────────────────────
ok('quota_alert_pct defaults to 90', () => {
  fs.rmSync(CONFIG_FILE, { force: true });
  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', undefined);
  assert.strictEqual(loadConfig().quota_alert_pct, DEFAULT_THRESHOLD);
});

ok('config.yaml overrides quota_alert_pct (env unset)', () => {
  fs.writeFileSync(CONFIG_FILE, 'quota_alert_pct: 70\n');
  assert.strictEqual(loadConfig().quota_alert_pct, 70);
});

ok('TOKEN_WATCH_QUOTA_ALERT_PCT beats config.yaml and the default', () => {
  fs.writeFileSync(CONFIG_FILE, 'quota_alert_pct: 70\n');
  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', '55');
  assert.strictEqual(loadConfig().quota_alert_pct, 55);
  fs.rmSync(CONFIG_FILE, { force: true });
  assert.strictEqual(loadConfig().quota_alert_pct, 55, 'env must win over the default');
  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', undefined);
  assert.strictEqual(loadConfig().quota_alert_pct, DEFAULT_THRESHOLD);
});

ok('existing keys survive the new key', () => {
  const cfg = loadConfig();
  assert.strictEqual(cfg.loop_pct, 80);
  assert.strictEqual(cfg.compact_pct, 80);
  assert.strictEqual(cfg.pre_compact_pct, 85);
  assert.strictEqual(cfg.loop_advisor, true);
});

// ── 1b. BOM UTF-8: a hand-edited config must not fall back to the defaults ────
// PowerShell 5.1 `Set-Content -Encoding utf8` (and Notepad's "UTF-8 with BOM")
// writes EF BB BF before the first `{`. JSON.parse rejects that byte, and the
// pre-fix code swallowed the throw → the file was ignored in total silence and
// every key silently reverted to its default. These checks live here (not in
// test/hooks-config.test.js) because lib/config.js is already required in this
// process under the diverted HOME: no child process needed.
ok('a UTF-8 BOM in config.json still applies the configured threshold', () => {
  fs.rmSync(CONFIG_FILE, { force: true });
  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', undefined);
  fs.writeFileSync(CONFIG_JSON_FILE, '\uFEFF' + JSON.stringify({ 'quota-alert-pct': 40 }));
  const bytes = fs.readFileSync(CONFIG_JSON_FILE);
  assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'fixture must carry a real UTF-8 BOM');
  assert.strictEqual(loadConfig().quota_alert_pct, 40,
    'config.json with a BOM was discarded: the threshold silently fell back to ' + DEFAULT_THRESHOLD);

  // …and the hook itself must act on it: 0.50 >= 0.40 fires, 0.50 < 0.90 stays mute.
  clearState();
  writeCache(cacheAt(0.50));
  assert.strictEqual(advisor.run({ session_id: 'quota-bom' }).emit, true,
    '0.50 must be warned about when the configured threshold is 40');
  fs.rmSync(CONFIG_JSON_FILE, { force: true });
  clearState();
  assert.strictEqual(advisor.run({ session_id: 'quota-bom2' }).emit, false,
    'control: 0.50 must stay silent once the file carrying the BOM is gone (default 90)');
});

ok('a UTF-8 BOM in config.yaml is tolerated as well (flat parser trims each line)', () => {
  fs.rmSync(CONFIG_JSON_FILE, { force: true });
  const raw = '\uFEFFquota_alert_pct: 45\n';
  fs.writeFileSync(CONFIG_FILE, raw);
  assert.strictEqual(raw.charCodeAt(0), 0xFEFF, 'fixture must start with U+FEFF');
  assert.strictEqual(loadConfig().quota_alert_pct, 45, 'the BOM made the first yaml line unreadable');
  fs.rmSync(CONFIG_FILE, { force: true });
});

ok('a truncated / non-JSON config.json stays silent and never throws (BOM fix did not change this)', () => {
  fs.writeFileSync(CONFIG_JSON_FILE, '\uFEFF{"quota-alert-pct":');
  assert.strictEqual(loadConfig().quota_alert_pct, DEFAULT_THRESHOLD);
  fs.writeFileSync(CONFIG_JSON_FILE, '\uFEFFnot json at all\n');
  assert.strictEqual(loadConfig().quota_alert_pct, DEFAULT_THRESHOLD);
  fs.rmSync(CONFIG_JSON_FILE, { force: true });
  assert.strictEqual(loadConfig().quota_alert_pct, DEFAULT_THRESHOLD);
});

// ── 2. 95 % >= 90 % → session warning emitted ─────────────────────────────────
ok('session5hPct 0.95 with threshold 0.90 → warning emitted', () => {
  clearState();
  writeCache(cacheAt(0.95));
  const res = advisor.run({ session_id: 'quota-s1' });
  assert.strictEqual(res.emit, true, 'expected an emission at 95%');
  const out = res.output;
  assert.ok(out && out.hookSpecificOutput, 'hookSpecificOutput missing');
  assert.ok(out.hookSpecificOutput.additionalContext, 'additionalContext missing');
  assert.ok(out.systemMessage, 'systemMessage missing');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('95%'), 'pct missing from advisory');
  assert.ok(out.systemMessage.includes('95%'), 'pct missing from banner');
  assert.ok(/quota/i.test(out.hookSpecificOutput.additionalContext), 'advisory must be a quota alert');
  assert.ok(out.hookSpecificOutput.additionalContext.includes(String(DEFAULT_THRESHOLD)),
    'advisory should name the crossed threshold');
  assert.ok(fs.existsSync(STATE_FILE), 'cooldown state must be written under the temp HOME');
});

// ── 3. 50 % < 90 % → nothing ──────────────────────────────────────────────────
ok('session5hPct 0.50 with threshold 0.90 → nothing emitted', () => {
  clearState();
  writeCache(cacheAt(0.50));
  const res = advisor.run({ session_id: 'quota-s2' });
  assert.strictEqual(res.emit, false, 'must stay silent below the threshold');
  assert.strictEqual(res.output, null, 'no parasitic output');
});

// ── 4. env override changes the behaviour ────────────────────────────────────
ok('TOKEN_WATCH_QUOTA_ALERT_PCT drives the hook threshold', () => {
  // Silence the loop advisory so only the quota threshold can fire.
  setEnv('TOKEN_WATCH_LOOP_PCT', '99');
  clearState();
  writeCache(cacheAt(0.95));

  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', '93');
  clearState();
  assert.strictEqual(advisor.run({ session_id: 'quota-s3' }).emit, true, '0.95 >= 0.93 must fire');

  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', '97');
  clearState();
  assert.strictEqual(advisor.run({ session_id: 'quota-s4' }).emit, false, '0.95 < 0.97 must stay silent');

  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', undefined);
  setEnv('TOKEN_WATCH_LOOP_PCT', undefined);
});

// ── 5. cooldown must not swallow the first alert / a crossing ────────────────
ok('a new session always gets its first alert despite a recent cooldown state', () => {
  clearState();
  writeCache(cacheAt(0.95));
  assert.strictEqual(advisor.run({ session_id: 'quota-a' }).emit, true);
  assert.strictEqual(advisor.run({ session_id: 'quota-a' }).emit, false, 'duplicate within cooldown');

  writeCache(cacheAt(0.95));
  assert.strictEqual(advisor.run({ session_id: 'quota-b' }).emit, true, 'new session must alert at once');
});

ok('crossing the quota threshold is not swallowed by a fresh loop advisory', () => {
  clearState();
  writeCache(cacheAt(0.85)); // loop advisory only (80 <= 0.85 < 90)
  const loopRes = advisor.run({ session_id: 'quota-c' });
  assert.strictEqual(loopRes.emit, true);
  assert.ok(!/quota_alert_pct/.test(loopRes.output.hookSpecificOutput.additionalContext),
    'below the quota threshold it must not claim a quota alert');

  writeCache(cacheAt(0.95)); // same session, seconds later
  const quotaRes = advisor.run({ session_id: 'quota-c' });
  assert.strictEqual(quotaRes.emit, true, 'quota crossing must escalate immediately');
  assert.ok(/quota/i.test(quotaRes.output.hookSpecificOutput.additionalContext));
});

ok('same session at 95% re-alerts once the cooldown has elapsed', () => {
  writeCache(cacheAt(0.95));
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    sessionId: 'quota-d',
    ts: Date.now() - 31 * 60 * 1000,
    pct: 0.95,
  }));
  assert.strictEqual(advisor.run({ session_id: 'quota-d' }).emit, true, 'stale state must not mask it');
});

// ── 6. edge cases: never throw, never emit garbage ───────────────────────────
const EDGE_CASES = [
  ['cache absent', () => clearCache()],
  ['cache corrupt', () => writeCache('not json at all {{')],
  ['cache is an empty object', () => writeCache({})],
  ['data key absent', () => writeCache({ fetchedAt: Date.now() })],
  ['session5hPct absent', () => writeCache({ data: { weekly7dPct: 0.9 } })],
  ['session5hPct a string', () => writeCache({ data: { session5hPct: '0.95' } })],
  ['session5hPct null', () => writeCache({ data: { session5hPct: null } })],
  ['session5hPct NaN', () => writeCache({ data: { session5hPct: NaN } })],
];

for (const [label, setup] of EDGE_CASES) {
  ok(label + ' → silent, no throw', () => {
    clearState();
    setup();
    const res = advisor.run({ session_id: 'quota-edge' });
    assert.strictEqual(res.emit, false, label + ': must not emit');
    assert.strictEqual(res.output, null, label + ': no parasitic output');
  });
}

ok('use-cache-shaped JSON.stringify(NaN) case (null on disk) → silent', () => {
  clearState();
  clearCache();
  writeCache('{"data":{"session5hPct":null},"fetchedAt":1}');
  assert.strictEqual(advisor.run({ session_id: 'quota-edge-2' }).emit, false);
});

// ── 7. text threshold must never raise, falls back to the default ────────────
ok('TOKEN_WATCH_QUOTA_ALERT_PCT=abc → no throw, default 90 applies', () => {
  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', 'abc');
  clearState();
  writeCache(cacheAt(0.95));
  const res = advisor.run({ session_id: 'quota-text' });
  assert.strictEqual(res.emit, true, 'must fall back to 90 and still alert at 95%');
  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', undefined);
});

ok('quota_alert_pct: abc in config.yaml → no throw, no emit at 50%', () => {
  fs.writeFileSync(CONFIG_FILE, 'quota_alert_pct: abc\n');
  clearState();
  writeCache(cacheAt(0.50));
  const res = advisor.run({ session_id: 'quota-text-2' });
  assert.strictEqual(res.emit, false);
  assert.strictEqual(res.output, null);
  fs.rmSync(CONFIG_FILE, { force: true });
});

ok('opt-out still honoured (TOKEN_WATCH_LOOP_ADVISOR=0)', () => {
  setEnv('TOKEN_WATCH_LOOP_ADVISOR', '0');
  clearState();
  writeCache(cacheAt(0.99));
  const res = advisor.run({ session_id: 'quota-off' });
  assert.strictEqual(res.emit, false);
  setEnv('TOKEN_WATCH_LOOP_ADVISOR', undefined);
});

// ── 8. metrics-writer.js must persist the SAME threshold as the alert ────────
// metrics.json.alert used to compare against a hardcoded 0.90, so a configured
// quota_alert_pct could be contradicted by the persisted field.

const METRICS_FILE = path.join(TW_DIR, 'metrics.json');

let writer;

/** Fresh cache (< CACHE_TTL_MS) so getUsage() returns it without any HTTP call. */
function writeFreshCache(pct) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify({
    data: { session5hPct: pct, weekly7dPct: 0.2, resetsSession: null, resetsWeekly: null },
    fetchedAt: Date.now(),
    failCount: 0,
    nextRetryAt: 0,
  }));
}

/** Run the real writer (compute + persist) and return what landed on disk. */
async function metricsWith(yaml, pct) {
  if (yaml === null) fs.rmSync(CONFIG_FILE, { force: true });
  else fs.writeFileSync(CONFIG_FILE, yaml);
  setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', undefined);
  fs.rmSync(METRICS_FILE, { force: true });
  writeFreshCache(pct);
  // Drop usage-api's in-memory layer so the fresh disk cache (this pct) is read;
  // a real hook always runs in a fresh process, so this only mirrors reality.
  api._resetCache();
  writer.writeMetrics(await writer.computeMetrics({}));
  return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
}

// These checks are async (they exercise the real writer), so they get their own
// sequential runner instead of the sync ok() above; same counter, same summary.
let sectionFailed = 0;
async function aok(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  OK ' + name);
  } catch (e) {
    sectionFailed++;
    console.log('  FAIL ' + name + '\n       ' + (e && e.message));
  }
}

(async function metricsWriterSection() {
  // Requiring the hook must neither run it nor kill this process. main() is
  // async, so a require-time run reaches its process.exit() a tick later: the
  // stub stays installed across the await to catch that too.
  const realExit = process.exit;
  let exitCalls = 0;
  process.exit = () => {
    exitCalls++;
    throw new Error('hooks/metrics-writer.js called process.exit() while being required');
  };
  try {
    writer = require('../hooks/metrics-writer');
    await new Promise((r) => setTimeout(r, 10));
  } finally {
    process.exit = realExit;
  }

  await aok('metrics-writer stays silent at require time (no run, no exit)', () => {
    assert.strictEqual(exitCalls, 0, 'metrics-writer ran at require time');
    assert.ok(!fs.existsSync(METRICS_FILE), 'metrics-writer wrote metrics.json at require time');
  });

  await aok('metrics-writer persists under the temporary HOME', () => {
    assert.strictEqual(writer.METRICS_FILE, METRICS_FILE);
    assert.strictEqual(writer.CACHE_FILE, CACHE_FILE);
  });

  await aok('quota_alert_pct 80 + quota 85% -> metrics.json.alert = true', async () => {
    const m = await metricsWith('quota_alert_pct: 80\n', 0.85);
    assert.strictEqual(m.quota_5h_pct, 0.85);
    assert.strictEqual(m.alert, true, 'the persisted alert must follow quota_alert_pct');
  });

  await aok('quota_alert_pct 90 + quota 85% -> metrics.json.alert = false', async () => {
    const m = await metricsWith('quota_alert_pct: 90\n', 0.85);
    assert.strictEqual(m.alert, false);
    assert.strictEqual(writer.quotaAlertThreshold(), 90);
  });

  await aok('absent or non-numeric quota_alert_pct -> fallback 90, never throws', async () => {
    for (const yaml of [null, 'quota_alert_pct: abc\n', 'quota_alert_pct: 0\n',
                        'quota_alert_pct: -5\n', 'loop_pct: 80\n']) {
      const m = await metricsWith(yaml, 0.85);
      assert.strictEqual(m.alert, false, 'fallback 90 must not alert at 85% (' + yaml + ')');
      assert.strictEqual(writer.quotaAlertThreshold(), 90);
      const high = await metricsWith(yaml, 0.95);
      assert.strictEqual(high.alert, true, 'fallback 90 must still alert at 95% (' + yaml + ')');
    }
  });

  await aok('absent or corrupt usage cache -> no throw, alert stays false', async () => {
    fs.rmSync(CONFIG_FILE, { force: true });
    setEnv('TOKEN_WATCH_QUOTA_ALERT_PCT', undefined);

    fs.rmSync(CACHE_FILE, { force: true });
    api._resetCache();
    const noCache = await writer.computeMetrics({});
    assert.strictEqual(noCache.alert, false);
    assert.strictEqual(noCache.quota_5h_pct, null);

    writeCache('{"data":{"session5hPct":');
    api._resetCache();
    const corrupt = await writer.computeMetrics({});
    assert.strictEqual(corrupt.alert, false);
    assert.strictEqual(corrupt.quota_5h_pct, null);
  });

  // ── cleanup ────────────────────────────────────────────────────────────────
  for (const f of [CACHE_FILE, STATE_FILE, CONFIG_FILE, CONFIG_JSON_FILE, METRICS_FILE]) fs.rmSync(f, { force: true });
  fs.rmSync(HOME, { recursive: true, force: true });

  console.log('\n' + passed + ' checks passed.\n');
  if (sectionFailed > 0) process.exit(1);
})();
