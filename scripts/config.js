#!/usr/bin/env node
'use strict';

/**
 * token-watch config — CLI for managing user-configurable thresholds.
 *
 * Stores settings in ~/.claude/token-watch/config.json
 * These values act as fallbacks: env var > config file > built-in default.
 *
 * Usage:
 *   token-watch-config set compact-pct <0-99>   # context-window compact threshold
 *   token-watch-config set loop-pct <0-99>      # 5h quota advisory threshold
 *   token-watch-config set quota-alert-pct <0-99> # 5h quota alert threshold
 *   token-watch-config get [key]                # show current effective config
 *   token-watch-config reset                    # restore built-in defaults
 *
 * Keys are accepted with dashes (CLI spelling) or underscores (config.yaml
 * spelling): `set quota_alert_pct 85` and `set quota-alert-pct 85` are the same.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const CONFIG_FILE = path.join(os.homedir(), '.claude', 'token-watch', 'config.json');

const VALID_KEYS = {
  'compact-pct': { envVar: 'TOKEN_WATCH_COMPACT_PCT', default: 80, description: 'Context-window % to trigger /compact nudge' },
  'loop-pct':    { envVar: 'TOKEN_WATCH_LOOP_PCT',    default: 80, description: '5h quota % to trigger loop advisor'         },
  'quota-alert-pct': { envVar: 'TOKEN_WATCH_QUOTA_ALERT_PCT', default: 90, description: '5h quota % above which the session alert fires' },
  'pre-compact-pct': { envVar: 'TOKEN_WATCH_PRE_COMPACT_PCT', default: 85, description: 'Context-window % to emit pre-compact warning (fires once per session)' },
};

/** config.yaml spells keys with underscores, this CLI with dashes. Accept both. */
function normalizeKey(key) {
  return typeof key === 'string' ? key.replace(/_/g, '-') : key;
}

// ── helpers ────────────────────────────────────────────────────────────────

// ── config file states ─────────────────────────────────────────────────────
// The CLI may create config.json only when it is ABSENT. When the file exists
// but cannot be read as a JSON object — a UTF-16 file written by PowerShell
// 5.1 (`>` or `Out-File`), a truncated file, commented JSON, an array root —
// writing from an empty object would silently destroy settings the user still
// has on disk. Those states are refused instead. readConfig() used to return
// `{}` indistinguishably and `set` overwrote the file with it.

/**
 * Read config.json and say which of the three states it is in:
 *   absent     — no file (or nothing stored yet): the only creatable case
 *   unreadable — present, non-blank, does not parse as JSON (encoding suspect)
 *   invalid    — parses, but the root is not a JSON object
 *   ok         — the settings
 */
function readConfigFile() {
  let buf;
  try {
    buf = fs.readFileSync(CONFIG_FILE);
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent', cfg: {} };
    return { state: 'unreadable', cfg: {}, detail: 'cannot be opened (' + e.message + ')' };
  }
  const bom = (buf[0] === 0xFF && buf[1] === 0xFE) ? 'UTF-16LE (BOM FF FE)'
            : (buf[0] === 0xFE && buf[1] === 0xFF) ? 'UTF-16BE (BOM FE FF)'
            : buf.includes(0x00)                   ? 'UTF-16 without BOM (NUL bytes present)'
            : null;
  const text = buf.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (text === '') return { state: 'absent', cfg: {} };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      state: 'unreadable',
      cfg: {},
      detail: bom ? 'it is not UTF-8 but ' + bom : 'invalid JSON (' + e.message + ')',
    };
  }
  if (Array.isArray(parsed)) return { state: 'invalid', cfg: {}, detail: 'the root is a JSON array, not an object' };
  if (!parsed || typeof parsed !== 'object') {
    return { state: 'invalid', cfg: {}, detail: 'the root is ' + (parsed === null ? 'null' : typeof parsed) + ', not an object' };
  }
  return { state: 'ok', cfg: parsed };
}

/** Lossy view kept for callers that only need the values; never used to decide a write. */
function readConfig() {
  return readConfigFile().cfg;
}

/**
 * Settings, or an explicit refusal. A file that exists but cannot be read is
 * never overwritten: exit non-zero, name the path and the suspected encoding,
 * and state that nothing was changed.
 */
function configOrExit() {
  const r = readConfigFile();
  if (r.state === 'ok' || r.state === 'absent') return r;
  const what = r.state === 'unreadable' ? 'unreadable' : 'invalid';
  console.error(`token-watch: ${CONFIG_FILE} is present but ${what} — ${r.detail}.`);
  console.error('token-watch: refusing to overwrite it; no modification was made.');
  console.error('token-watch: it must be a UTF-8 JSON object — fix it or delete it, then retry.');
  process.exit(1);
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** Effective value: env > config file > default */
function effectiveValue(key, cfg) {
  const meta = VALID_KEYS[key];
  const fromEnv = process.env[meta.envVar];
  if (fromEnv !== undefined && !isNaN(Number(fromEnv))) {
    return { value: Number(fromEnv), source: `env:${meta.envVar}` };
  }
  if (cfg[key] !== undefined) {
    return { value: cfg[key], source: 'config.json' };
  }
  return { value: meta.default, source: 'default' };
}

// ── commands ───────────────────────────────────────────────────────────────

function cmdSet(rawKey, rawValue) {
  const key = normalizeKey(rawKey);
  if (!VALID_KEYS[key]) {
    console.error(`Unknown key: "${rawKey}". Valid keys: ${Object.keys(VALID_KEYS).join(', ')}`);
    process.exit(1);
  }
  const num = parseInt(rawValue, 10);
  if (isNaN(num) || num < 0 || num > 99) {
    console.error(`Invalid value "${rawValue}" for "${key}". Must be an integer between 0 and 99.`);
    process.exit(1);
  }
  const { cfg } = configOrExit();
  cfg[key] = num;
  writeConfig(cfg);
  console.log(`token-watch: "${key}" set to ${num}% (stored in ${CONFIG_FILE})`);
}

function cmdGet(rawFilterKey) {
  const { state, cfg } = configOrExit();
  const filterKey = normalizeKey(rawFilterKey) || null;
  const keys = filterKey ? [filterKey] : Object.keys(VALID_KEYS);

  if (filterKey && !VALID_KEYS[filterKey]) {
    console.error(`Unknown key: "${rawFilterKey}". Valid keys: ${Object.keys(VALID_KEYS).join(', ')}`);
    process.exit(1);
  }

  console.log('token-watch config (env > config file > default):');
  console.log('');
  for (const key of keys) {
    const meta  = VALID_KEYS[key];
    const eff   = effectiveValue(key, cfg);
    const stored = cfg[key] !== undefined ? `${cfg[key]}%` : '—';
    console.log(`  ${key.padEnd(14)} ${String(eff.value + '%').padEnd(6)}  [source: ${eff.source}]`);
    console.log(`    ${meta.description}`);
    console.log(`    stored=${stored}  default=${meta.default}%  env=${process.env[meta.envVar] || '(unset)'}`);
    console.log('');
  }
  console.log(`  Config file: ${CONFIG_FILE}`);
  console.log(state === 'absent'
    ? '    state: absent — nothing stored there, the defaults above apply'
    : '    state: present and readable');
}

function cmdReset() {
  try {
    fs.unlinkSync(CONFIG_FILE);
    console.log('token-watch: config reset to built-in defaults.');
    console.log(`  Deleted: ${CONFIG_FILE}`);
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('token-watch: config file not found — already at defaults.');
    } else {
      console.error('token-watch: failed to reset config:', e.message);
      process.exit(1);
    }
  }
}

function printHelp() {
  console.log('Usage:');
  console.log('  token-watch-config set compact-pct <0-99>     # context % to trigger /compact nudge');
  console.log('  token-watch-config set loop-pct <0-99>        # 5h quota % to trigger loop advisor');
  console.log('  token-watch-config set quota-alert-pct <0-99> # 5h quota % to trigger the alert');
  console.log('  token-watch-config set pre-compact-pct <0-99> # context % to emit pre-compact warning');
  console.log('  token-watch-config get [key]                  # show current effective config');
  console.log('  token-watch-config reset                      # restore built-in defaults');
  console.log('');
  console.log('Priority: env variable > config file > built-in default');
  console.log(`Config file: ${CONFIG_FILE}`);
}

// ── main ───────────────────────────────────────────────────────────────────

function main() {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'set':
      if (args.length < 2) { console.error('Usage: token-watch-config set <key> <value>'); process.exit(1); }
      cmdSet(args[0], args[1]);
      break;
    case 'get':
      cmdGet(args[0] || null);
      break;
    case 'reset':
      cmdReset();
      break;
    default:
      printHelp();
      if (cmd && cmd !== '--help' && cmd !== '-h') {
        console.error(`\nUnknown command: "${cmd}"`);
        process.exit(1);
      }
  }
}

if (require.main === module) main();

module.exports = {
  CONFIG_FILE,
  VALID_KEYS,
  normalizeKey,
  readConfig,
  readConfigFile,
  configOrExit,
  writeConfig,
  effectiveValue,
  cmdSet,
  cmdGet,
  cmdReset,
  main,
};
