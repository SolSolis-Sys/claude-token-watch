'use strict';

/**
 * Unit tests for scripts/config.js — set / get / reset / validation.
 *
 * Runs in an isolated temp directory so it never touches the real
 * ~/.claude/token-watch/config.json.
 *
 * Run: node test/config.test.js
 */

const assert  = require('assert');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const { execFileSync } = require('child_process');

// ── test harness ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('       ' + e.message);
  }
}

// ── setup: temp home dir ─────────────────────────────────────────────────

const tmpHome   = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-config-test-'));
const configDir = path.join(tmpHome, '.claude', 'token-watch');
const configFile = path.join(configDir, 'config.json');
const configScript = path.join(__dirname, '..', 'scripts', 'config.js');

function runConfig(args, env = {}) {
  return execFileSync(process.execPath, [configScript, ...args], {
    env:      { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, ...env },
    encoding: 'utf8',
  });
}

function runConfigExpectFail(args, env = {}) {
  try {
    execFileSync(process.execPath, [configScript, ...args], {
      env:      { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, ...env },
      encoding: 'utf8',
    });
    return null; // should have thrown
  } catch (e) {
    return e;
  }
}

function readCfg() {
  try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return null; }
}

// ── tests ────────────────────────────────────────────────────────────────

console.log('token-watch config test\n');

ok('set compact-pct writes to config.json', () => {
  runConfig(['set', 'compact-pct', '90']);
  const cfg = readCfg();
  assert.ok(cfg, 'config.json should exist after set');
  assert.strictEqual(cfg['compact-pct'], 90, 'compact-pct should be 90');
});

ok('set loop-pct writes to config.json', () => {
  runConfig(['set', 'loop-pct', '85']);
  const cfg = readCfg();
  assert.strictEqual(cfg['loop-pct'], 85, 'loop-pct should be 85');
});

ok('get returns both keys without error', () => {
  const out = runConfig(['get']);
  assert.ok(out.includes('compact-pct'), 'output should mention compact-pct');
  assert.ok(out.includes('loop-pct'),    'output should mention loop-pct');
  assert.ok(out.includes('90'),          'should show value 90');
  assert.ok(out.includes('85'),          'should show value 85');
});

ok('get with specific key returns only that key', () => {
  const out = runConfig(['get', 'compact-pct']);
  assert.ok(out.includes('compact-pct'), 'output should mention compact-pct');
});

ok('validation rejects non-numeric value', () => {
  const err = runConfigExpectFail(['set', 'compact-pct', 'abc']);
  assert.ok(err !== null, 'should have exited with error');
  assert.ok(err.status !== 0, 'exit code should be non-zero');
});

ok('validation rejects value > 99', () => {
  const err = runConfigExpectFail(['set', 'compact-pct', '100']);
  assert.ok(err !== null, 'should have exited with error');
  assert.ok(err.status !== 0, 'exit code should be non-zero');
});

ok('validation rejects unknown key', () => {
  const err = runConfigExpectFail(['set', 'unknown-key', '50']);
  assert.ok(err !== null, 'should have exited with error');
  assert.ok(err.status !== 0, 'exit code should be non-zero');
});

ok('reset deletes config.json', () => {
  // Ensure file exists first
  assert.ok(fs.existsSync(configFile), 'config.json should exist before reset');
  runConfig(['reset']);
  assert.ok(!fs.existsSync(configFile), 'config.json should be gone after reset');
});

ok('reset on missing file exits cleanly', () => {
  assert.ok(!fs.existsSync(configFile), 'precondition: no config.json');
  // Should not throw
  const out = runConfig(['reset']);
  assert.ok(out.includes('defaults'), 'should confirm defaults');
});

ok('set creates parent directories if absent', () => {
  // tmpHome already exists but configDir may have been cleaned
  fs.rmSync(configDir, { recursive: true, force: true });
  assert.ok(!fs.existsSync(configDir), 'dir should not exist before set');
  runConfig(['set', 'loop-pct', '70']);
  assert.ok(fs.existsSync(configFile), 'config.json should be created even when dir is absent');
});

// ── summary ───────────────────────────────────────────────────────────────

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
