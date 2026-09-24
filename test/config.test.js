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
const { spawnSync } = require('child_process');

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

/**
 * Run the CLI in a real child process.
 *
 * stdio goes through file descriptors rather than pipes: a pipe needs the
 * child's stdout/stderr to be captured through a named pipe, which an
 * OS-level sandbox refuses (spawnSync EPERM). The fd route behaves identically
 * everywhere, so this file stays runnable inside and outside a sandbox.
 */
function runCliProcess(args, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-config-run-'));
  const outFile = path.join(dir, 'stdio.txt');
  const fd = fs.openSync(outFile, 'w');
  let status = null;
  try {
    const res = spawnSync(process.execPath, [configScript, ...args], {
      stdio: ['ignore', fd, fd],
      env:   { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome, ...env },
    });
    status = res.status;
  } finally {
    fs.closeSync(fd);
  }
  const out = fs.readFileSync(outFile, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return { status, out };
}

function runConfig(args, env = {}) {
  const r = runCliProcess(args, env);
  if (r.status !== 0) throw new Error('config CLI exited ' + r.status + ': ' + r.out);
  return r.out;
}

function runConfigExpectFail(args, env = {}) {
  const r = runCliProcess(args, env);
  if (r.status === 0) return null; // should have failed
  const e = new Error('config CLI exited ' + r.status);
  e.status = r.status;
  e.stdout = r.out;
  return e;
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

ok('set pre-compact-pct writes to config.json', () => {
  runConfig(['set', 'pre-compact-pct', '75']);
  const cfg = readCfg();
  assert.strictEqual(cfg['pre-compact-pct'], 75, 'pre-compact-pct should be 75');
});

ok('get shows pre-compact-pct', () => {
  const out = runConfig(['get']);
  assert.ok(out.includes('pre-compact-pct'), 'output should mention pre-compact-pct');
});

ok('validation rejects unknown key still works', () => {
  const err = runConfigExpectFail(['set', 'bad-key', '50']);
  assert.ok(err !== null && err.status !== 0, 'should reject unknown key');
});

// ── in-process CLI parity (no child spawn) ────────────────────────────────
// The sandbox refuses piped-stdio spawns, so the CLI is also exercised
// in-process through its exports. HOME/USERPROFILE are redirected first so
// CONFIG_FILE (resolved at require time) lands under the temp HOME.

process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

let cli = null;

ok('config CLI does nothing when simply required (no help text, no exit)', () => {
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const noise = [];
  process.exit = () => {
    noise.push('process.exit()');
    throw new Error('config CLI called process.exit() while being required');
  };
  console.log = (...a) => noise.push(a.join(' '));
  console.error = (...a) => noise.push(a.join(' '));
  try {
    cli = require(configScript);
  } finally {
    process.exit = realExit;
    console.log = realLog;
    console.error = realErr;
  }
  assert.strictEqual(noise.length, 0, 'must stay silent at require time, got: ' + noise.join(' | '));
  assert.ok(cli && cli.CONFIG_FILE, 'CLI must export its resolved config path');
  assert.strictEqual(cli.CONFIG_FILE, configFile, 'must resolve under the temp HOME');
});

/** Run a CLI command in-process; process.exit becomes a throw so refusals are assertable. */
function runCli(fn) {
  const out = [];
  const err = [];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  process.exit = (code = 0) => {
    const e = new Error('process.exit(' + code + ')');
    e.exitCode = code;
    throw e;
  };
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    fn();
    return { ok: true, out: out.join('\n'), err: err.join('\n') };
  } catch (e) {
    return { ok: false, exitCode: e.exitCode, out: out.join('\n'), err: err.join('\n') };
  } finally {
    process.exit = realExit;
    console.log = realLog;
    console.error = realErr;
  }
}

ok('quota-alert-pct is a valid CLI key with default 90', () => {
  const meta = cli.VALID_KEYS['quota-alert-pct'];
  assert.ok(meta, 'quota-alert-pct must be listed in VALID_KEYS');
  assert.strictEqual(meta.default, 90);
  assert.strictEqual(meta.envVar, 'TOKEN_WATCH_QUOTA_ALERT_PCT');
});

ok('set quota_alert_pct 85 (config.yaml spelling) is accepted', () => {
  fs.rmSync(configFile, { force: true });
  const r = runCli(() => cli.cmdSet('quota_alert_pct', '85'));
  assert.ok(r.ok, 'must be accepted, got: ' + r.err);
  assert.ok(r.out.includes('85%'), 'confirmation should quote the value');
  assert.strictEqual(readCfg()['quota-alert-pct'], 85, 'stored under the canonical dashed key');
});

ok('set quota-alert-pct 75 (dashed spelling) drives the same setting', () => {
  const r = runCli(() => cli.cmdSet('quota-alert-pct', '75'));
  assert.ok(r.ok, 'must be accepted, got: ' + r.err);
  assert.strictEqual(readCfg()['quota-alert-pct'], 75);
  assert.strictEqual(readCfg()['quota_alert_pct'], undefined, 'only one spelling on disk');
});

ok('quota-alert-pct gets the same bounds as the other percentages', () => {
  for (const bad of ['100', '-1', 'abc']) {
    const quota = runCli(() => cli.cmdSet('quota-alert-pct', bad));
    const loop = runCli(() => cli.cmdSet('loop-pct', bad));
    assert.strictEqual(quota.ok, false, `quota-alert-pct must refuse "${bad}"`);
    assert.strictEqual(loop.ok, false, `loop-pct must refuse "${bad}"`);
    assert.strictEqual(quota.exitCode, loop.exitCode, `same exit code as loop-pct for "${bad}"`);
  }
  assert.strictEqual(readCfg()['quota-alert-pct'], 75, 'refused values must not be stored');
});

ok('unknown keys are still refused in-process', () => {
  const r = runCli(() => cli.cmdSet('bogus-key', '50'));
  assert.strictEqual(r.ok, false, 'unknown key must be refused');
  assert.ok(r.err.includes('Unknown key'), 'error must name the problem');
  assert.strictEqual(readCfg()['bogus-key'], undefined);
});

ok('get covers quota-alert-pct with env > config file > default', () => {
  process.env.TOKEN_WATCH_QUOTA_ALERT_PCT = '55';
  const eff = cli.effectiveValue('quota-alert-pct', cli.readConfig());
  assert.strictEqual(eff.value, 55);
  assert.ok(eff.source.startsWith('env:'), 'env must win, got ' + eff.source);

  const all = runCli(() => cli.cmdGet(null));
  assert.ok(all.out.includes('quota-alert-pct'), 'list must include the key');
  assert.ok(all.out.includes('55'), 'list must show the effective value');

  const one = runCli(() => cli.cmdGet('quota_alert_pct'));
  assert.ok(one.ok, 'get must accept the underscore spelling, got: ' + one.err);
  assert.ok(one.out.includes('quota-alert-pct'));

  delete process.env.TOKEN_WATCH_QUOTA_ALERT_PCT;
  assert.strictEqual(cli.effectiveValue('quota-alert-pct', cli.readConfig()).value, 75, 'stored value');
  assert.strictEqual(cli.effectiveValue('quota-alert-pct', {}).value, 90, 'default');
});

ok('reset returns quota-alert-pct to the default', () => {
  const r = runCli(() => cli.cmdReset());
  assert.ok(r.ok, 'reset must succeed, got: ' + r.err);
  assert.ok(!fs.existsSync(configFile), 'config.json must be gone');
  const eff = cli.effectiveValue('quota-alert-pct', cli.readConfig());
  assert.strictEqual(eff.value, 90);
  assert.strictEqual(eff.source, 'default');
});

// ── UTF-8 BOM: `set` must not destroy the settings already stored ─────────
// Same hand-edited-file shape as the hooks (PowerShell 5.1 `Set-Content
// -Encoding utf8`, Notepad "UTF-8 with BOM"): a raw JSON.parse returns {},
// and `set` then wrote that empty object plus the new key back to disk, so
// every other setting was silently destroyed. In-process, no spawn.

function writeBomConfig(obj) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, '\uFEFF' + JSON.stringify(obj, null, 2) + '\n');
  const bytes = fs.readFileSync(configFile);
  assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'fixture must carry a real UTF-8 BOM');
}

ok('readConfig() reads a config.json carrying a UTF-8 BOM', () => {
  fs.rmSync(configFile, { force: true });
  writeBomConfig({ 'compact-pct': 60, 'loop-pct': 70, 'quota-alert-pct': 40 });
  const cfg = cli.readConfig();
  assert.strictEqual(cfg['compact-pct'], 60, 'the BOM made readConfig() return {}');
  assert.strictEqual(cfg['loop-pct'], 70, 'the BOM made readConfig() return {}');
  assert.strictEqual(cfg['quota-alert-pct'], 40, 'the BOM made readConfig() return {}');
});

ok('set on a BOM-carrying config.json keeps every other key (no silent loss)', () => {
  fs.rmSync(configFile, { force: true });
  writeBomConfig({ 'compact-pct': 60, 'loop-pct': 70, 'quota-alert-pct': 40 });
  const r = runCli(() => cli.cmdSet('quota-alert-pct', '55'));
  assert.ok(r.ok, 'set must succeed, got: ' + r.err);
  assert.deepStrictEqual(readCfg(), { 'compact-pct': 60, 'loop-pct': 70, 'quota-alert-pct': 55 },
    'only the targeted key may change, nothing may be added or dropped');
  assert.strictEqual(fs.readFileSync(configFile)[0], 0x7B,
    'the CLI writes plain JSON — it must not add a BOM of its own');
});

ok('a config.json without a BOM behaves exactly as before the fix', () => {
  fs.rmSync(configFile, { force: true });
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ 'compact-pct': 60, 'loop-pct': 70, 'quota-alert-pct': 40 }, null, 2) + '\n');
  assert.deepStrictEqual(cli.readConfig(), { 'compact-pct': 60, 'loop-pct': 70, 'quota-alert-pct': 40 });
  const r = runCli(() => cli.cmdSet('loop-pct', '45'));
  assert.ok(r.ok, 'set must succeed, got: ' + r.err);
  assert.deepStrictEqual(readCfg(), { 'compact-pct': 60, 'loop-pct': 45, 'quota-alert-pct': 40 });
});

// ── a present-but-unreadable config.json is refused, never overwritten ────
// readConfig() used to return {} for every failure, so `set` rewrote the file
// with that empty object: a UTF-16LE file written by PowerShell 5.1 (`>` or
// `Out-File`), a truncated file, commented JSON or an array root each lost
// every stored setting while still reporting success. The CLI must refuse.

function snapshot() {
  const st = fs.statSync(configFile);
  return { size: st.size, mtimeMs: st.mtimeMs, bytes: fs.readFileSync(configFile) };
}

function writeRaw(content) {
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.rmSync(configFile, { force: true });
  fs.writeFileSync(configFile, content);
}

function refusedSet(...expect) {
  const before = snapshot();
  const r = runCli(() => cli.cmdSet('quota-alert-pct', '55'));
  assert.strictEqual(r.ok, false, 'the CLI must refuse, not report success');
  assert.strictEqual(r.exitCode, 1, 'exit code must be non-zero');
  assert.ok(r.err.includes(configFile), 'the message must name the file, got: ' + r.err);
  assert.ok(r.err.includes('no modification was made'), 'the message must say nothing was written: ' + r.err);
  for (const word of expect) assert.ok(r.err.includes(word), 'the message should say "' + word + '", got: ' + r.err);
  const after = snapshot();
  assert.strictEqual(after.size, before.size, 'size must not change');
  assert.strictEqual(after.mtimeMs, before.mtimeMs, 'mtime must not change');
  assert.deepStrictEqual(after.bytes, before.bytes, 'content must not change');
}

ok('a UTF-16LE config.json (PowerShell `>` / Out-File) is refused, not overwritten', () => {
  writeRaw(Buffer.concat([
    Buffer.from([0xFF, 0xFE]),
    Buffer.from('{"compact-pct": 60, "loop-pct": 70, "quota-alert-pct": 40}\r\n', 'utf16le'),
  ]));
  refusedSet('unreadable', 'UTF-16LE', 'FF FE');
});

ok('a truncated config.json is refused, not overwritten', () => {
  writeRaw('{"compact-pct": 60, "loop-pct"');
  refusedSet('unreadable', 'invalid JSON');
});

ok('a commented config.json is refused, not overwritten', () => {
  writeRaw('{\n  // mes reglages\n  "compact-pct": 60,\n  "loop-pct": 70,\n  "quota-alert-pct": 40\n}\n');
  refusedSet('unreadable');
});

ok('a JSON array root is invalid content, not an empty config', () => {
  writeRaw('[1, 2, 3]');
  refusedSet('invalid', 'array');
  assert.strictEqual(cli.readConfigFile().state, 'invalid', 'an array root is invalid, not absent');
  const g = runCli(() => cli.cmdGet('quota-alert-pct'));
  assert.strictEqual(g.ok, false, 'get must not pretend the defaults apply to a file it cannot read');
  assert.strictEqual(g.exitCode, 1);
  assert.strictEqual(fs.readFileSync(configFile, 'utf8'), '[1, 2, 3]', 'the file must still be untouched');
});

ok('the three states are told apart: absent vs unreadable vs invalid', () => {
  fs.rmSync(configFile, { force: true });
  assert.strictEqual(cli.readConfigFile().state, 'absent');
  const gone = runCli(() => cli.cmdGet(null));
  assert.ok(gone.ok, 'get must work without a file, got: ' + gone.err);
  assert.ok(gone.out.includes('state: absent'), 'get must say the file is absent: ' + gone.out);

  writeRaw('not json at all');
  assert.strictEqual(cli.readConfigFile().state, 'unreadable');
  writeRaw('[1]');
  assert.strictEqual(cli.readConfigFile().state, 'invalid');
  writeRaw('{"quota-alert-pct": 40}');
  assert.strictEqual(cli.readConfigFile().state, 'ok');
  assert.strictEqual(cli.readConfigFile().cfg['quota-alert-pct'], 40, 'the ok state carries the settings');
  assert.ok(runCli(() => cli.cmdGet(null)).out.includes('present and readable'));
});

ok('an absent config.json is still created by set (the only creatable case)', () => {
  fs.rmSync(configFile, { force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
  const r = runCli(() => cli.cmdSet('quota-alert-pct', '40'));
  assert.ok(r.ok, 'an absent file must stay creatable, got: ' + r.err);
  assert.deepStrictEqual(readCfg(), { 'quota-alert-pct': 40 });
});

// ── end-to-end: what the CLI writes must be what the hooks read ───────────
// lib/config.js is required here, after HOME was redirected above, so it
// resolves config.yaml/config.json under the temp HOME.

const { loadConfig, CONFIG_JSON_PATH } = require('../lib/config.js');
const yamlFile = path.join(tmpHome, '.claude', 'token-watch', 'config.yaml');

function clearPctEnv() {
  for (const k of ['TOKEN_WATCH_COMPACT_PCT', 'TOKEN_WATCH_LOOP_PCT',
                   'TOKEN_WATCH_QUOTA_ALERT_PCT', 'TOKEN_WATCH_PRE_COMPACT_PCT']) {
    delete process.env[k];
  }
}

ok('a key set through the CLI is resolved by loadConfig()', () => {
  clearPctEnv();
  fs.rmSync(yamlFile, { force: true });
  const r = runCli(() => cli.cmdSet('quota_alert_pct', '85'));
  assert.ok(r.ok, 'CLI set must succeed, got: ' + r.err);
  assert.strictEqual(CONFIG_JSON_PATH, configFile, 'both layers must read the temp HOME');
  assert.strictEqual(loadConfig().quota_alert_pct, 85, 'loadConfig must see the CLI value');
});

ok('config.yaml still wins over config.json', () => {
  clearPctEnv();
  fs.mkdirSync(path.dirname(yamlFile), { recursive: true });
  fs.writeFileSync(yamlFile, 'quantum_bogus: 1\nloop_pct: 55\nquota_alert_pct: 44\n');
  const cfg = loadConfig();
  assert.strictEqual(cfg.quota_alert_pct, 44, 'yaml beats the CLI-written json');
  assert.strictEqual(cfg.loop_pct, 55, 'the other yaml key is applied too');
  assert.strictEqual(readCfg()['quota-alert-pct'], 85, 'json is still there, just outranked');
});

ok('the env var still wins over both files', () => {
  process.env.TOKEN_WATCH_QUOTA_ALERT_PCT = '33';
  assert.strictEqual(loadConfig().quota_alert_pct, 33);
  clearPctEnv();
  assert.strictEqual(loadConfig().quota_alert_pct, 44, 'back to yaml once the env var is gone');
});

ok('an absent, unreadable or non-JSON config.json never throws', () => {
  clearPctEnv();
  fs.rmSync(yamlFile, { force: true });

  fs.rmSync(configFile, { force: true });
  assert.strictEqual(loadConfig().quota_alert_pct, 90, 'absent json → default');

  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.writeFileSync(configFile, '{"quota-alert-pct": ');
  assert.strictEqual(loadConfig().quota_alert_pct, 90, 'truncated json → default');

  fs.writeFileSync(configFile, '[1, 2, 3]');
  assert.strictEqual(loadConfig().quota_alert_pct, 90, 'json array → default');

  fs.writeFileSync(configFile, 'null');
  assert.strictEqual(loadConfig().quota_alert_pct, 90, 'json null → default');

  fs.writeFileSync(configFile, '{"quota_alert_pct": 66}');
  assert.strictEqual(loadConfig().quota_alert_pct, 66, 'the underscore spelling is honoured too');

  fs.writeFileSync(configFile, '{"quota-alert-pct": "70"}');
  assert.strictEqual(loadConfig().quota_alert_pct, '70', 'value passes through unchanged');
});

// ── summary ───────────────────────────────────────────────────────────────

fs.rmSync(tmpHome, { recursive: true, force: true });

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
