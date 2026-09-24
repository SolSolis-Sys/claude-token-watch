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

function readConfig() {
  try {
    // config.json is hand-editable; PowerShell 5.1 `Set-Content -Encoding utf8`
    // and Notepad write a UTF-8 BOM, which JSON.parse rejects. The pre-fix
    // catch returned {} — so `set` not only ignored every existing key, it
    // overwrote the file with a single-key object and destroyed the settings.
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
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
  const cfg = readConfig();
  cfg[key] = num;
  writeConfig(cfg);
  console.log(`token-watch: "${key}" set to ${num}% (stored in ${CONFIG_FILE})`);
}

function cmdGet(rawFilterKey) {
  const cfg = readConfig();
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
  writeConfig,
  effectiveValue,
  cmdSet,
  cmdGet,
  cmdReset,
  main,
};
