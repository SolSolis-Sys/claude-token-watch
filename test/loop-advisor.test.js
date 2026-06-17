'use strict';

/**
 * Tests for hooks/loop-advisor.js
 *
 * The hook reads the disk cache, compares session5hPct to threshold,
 * and emits additionalContext + systemMessage when usage is high.
 * No API calls — disk cache only.
 *
 * Run: node test/loop-advisor.test.js
 */

const assert = require('assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { execSync } = require('child_process');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}

const CACHE_DIR  = path.join(os.homedir(), '.claude', 'token-watch');
const CACHE_FILE = path.join(CACHE_DIR, 'usage-cache.json');
const HOOK       = path.resolve(__dirname, '../hooks/loop-advisor.js');

/** Write a fake disk cache entry */
function writeCache(overrides) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const entry = Object.assign({
    data: {
      session5hPct: 0.85,
      weekly7dPct: 0.40,
      resetsSession: new Date(Date.now() + 32 * 60 * 1000).toISOString(),
      resetsWeekly: null,
    },
    fetchedAt: Date.now(),
    tlsInsecureOk: false,
    failCount: 0,
    nextRetryAt: 0,
  }, overrides);
  fs.writeFileSync(CACHE_FILE, JSON.stringify(entry));
}

/** Remove disk cache */
function clearCache() {
  try { fs.unlinkSync(CACHE_FILE); } catch { /* absent = ok */ }
}

/** Run the hook as a child process, return { stdout, exitCode } */
function runHook(env) {
  const e = Object.assign({}, process.env, env);
  // suppress color codes
  e.NO_COLOR = '1';
  try {
    const out = execSync(`node "${HOOK}"`, { input: '{}', env: e, encoding: 'utf8' });
    return { stdout: out, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', exitCode: err.status || 1 };
  }
}

console.log('loop-advisor hook tests\n');

// ── No cache — no output ─────────────────────────────────────────────────────
ok('no disk cache → silent exit (no output)', () => {
  clearCache();
  const { stdout, exitCode } = runHook({});
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(stdout.trim(), '');
});

// ── Below threshold — no output ───────────────────────────────────────────────
ok('session5hPct below default threshold (80%) → silent exit', () => {
  writeCache({ data: { session5hPct: 0.75, weekly7dPct: 0.30, resetsSession: null, resetsWeekly: null } });
  const { stdout, exitCode } = runHook({});
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(stdout.trim(), '');
});

// ── Above threshold — advisory emitted ───────────────────────────────────────
ok('session5hPct at 85% → emits additionalContext + systemMessage', () => {
  writeCache(); // default: 85%, reset in 32min
  const { stdout, exitCode } = runHook({});
  assert.strictEqual(exitCode, 0);
  assert.ok(stdout.trim().length > 0, 'expected non-empty output');
  const out = JSON.parse(stdout);
  assert.ok(out.hookSpecificOutput, 'hookSpecificOutput present');
  assert.ok(out.hookSpecificOutput.additionalContext, 'additionalContext present');
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit', 'hookEventName correct');
  assert.ok(out.systemMessage, 'systemMessage present');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('85%'), 'pct in additionalContext');
  assert.ok(out.systemMessage.includes('85%'), 'pct in systemMessage');
});

// ── Custom threshold ──────────────────────────────────────────────────────────
ok('TOKEN_WATCH_LOOP_PCT=90 → silent when 85%', () => {
  writeCache(); // 85%
  const { stdout, exitCode } = runHook({ TOKEN_WATCH_LOOP_PCT: '90' });
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(stdout.trim(), '');
});

ok('TOKEN_WATCH_LOOP_PCT=70 → warns when 75%', () => {
  writeCache({ data: { session5hPct: 0.75, weekly7dPct: 0.30, resetsSession: null, resetsWeekly: null } });
  const { stdout, exitCode } = runHook({ TOKEN_WATCH_LOOP_PCT: '70' });
  assert.strictEqual(exitCode, 0);
  const out = JSON.parse(stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('75%'));
});

// ── Imminent reset ────────────────────────────────────────────────────────────
ok('reset in 10min → imminent message (do NOT start loop)', () => {
  writeCache({
    data: {
      session5hPct: 0.92,
      weekly7dPct: 0.50,
      resetsSession: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      resetsWeekly: null,
    },
  });
  const { stdout } = runHook({});
  const out = JSON.parse(stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.toLowerCase().includes('imminent'), 'imminent msg');
  assert.ok(out.systemMessage.includes('⛔'), 'red flag icon');
});

// ── Opt-out ───────────────────────────────────────────────────────────────────
ok('TOKEN_WATCH_LOOP_ADVISOR=0 → silent exit regardless of usage', () => {
  writeCache(); // 85%
  const { stdout, exitCode } = runHook({ TOKEN_WATCH_LOOP_ADVISOR: '0' });
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(stdout.trim(), '');
});

// ── Corrupt cache — no crash ──────────────────────────────────────────────────
ok('corrupt disk cache → silent exit (no crash)', () => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, 'not json at all {{');
  const { stdout, exitCode } = runHook({});
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(stdout.trim(), '');
});

// ── cleanup ───────────────────────────────────────────────────────────────────
clearCache();

console.log(`\n${passed} tests passed`);
