'use strict';

/**
 * config.js — Centralized configuration for token-watch.
 *
 * Reads ~/.claude/token-watch/config.yaml (flat YAML, zero dependencies) and,
 * as a fallback, ~/.claude/token-watch/config.json (written by scripts/config.js).
 * Priority: env var > config.yaml > config.json > default.
 * Non-breaking: if the files don't exist, all defaults apply.
 *
 * Supported keys and their env var equivalents:
 *   plan                   TOKEN_WATCH_PLAN
 *   context_window         TOKEN_WATCH_CONTEXT_WINDOW
 *   session_cap            TOKEN_WATCH_SESSION_CAP
 *   weekly_cap             TOKEN_WATCH_WEEKLY_CAP
 *   compact_pct            TOKEN_WATCH_COMPACT_PCT
 *   loop_pct               TOKEN_WATCH_LOOP_PCT
 *   quota_alert_pct        TOKEN_WATCH_QUOTA_ALERT_PCT  (5h quota alert, default 90)
 *   pre_compact_pct        TOKEN_WATCH_PRE_COMPACT_PCT
 *   loop_advisor           TOKEN_WATCH_LOOP_ADVISOR  ('0' = false)
 *   tls_strict             TOKEN_WATCH_TLS_STRICT    ('1' = true)
 *   show_cache_ttl         (no env var — yaml only, with a default)
 *   cache_warning_seconds  (no env var — yaml only, with a default)
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'token-watch', 'config.yaml');
const CONFIG_JSON_PATH = path.join(os.homedir(), '.claude', 'token-watch', 'config.json');

/** Defaults for every key. */
const DEFAULTS = {
  plan:                  null,        // null = auto-detect
  context_window:        0,           // 0 = auto from model
  session_cap:           0,           // 0 = from plan
  weekly_cap:            0,           // 0 = from plan
  compact_pct:           80,
  loop_pct:              80,
  quota_alert_pct:       90,
  pre_compact_pct:       85,
  loop_advisor:          true,
  tls_strict:            false,
  show_cache_ttl:        true,
  cache_warning_seconds: 60,
};

/**
 * Parse a flat YAML file (key: value lines only).
 * - Skips empty lines and lines starting with #.
 * - Skips lines that don't match "key: value".
 * - Coerces value to number, boolean, or string.
 * @param {string} raw
 * @returns {Object}
 */
function parseFlatYaml(raw) {
  const result = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (!key || val === '') continue;
    // Coerce value
    if (val === 'true')  { result[key] = true;  continue; }
    if (val === 'false') { result[key] = false; continue; }
    if (val === 'null' || val === '~') { result[key] = null; continue; }
    const num = Number(val);
    if (!isNaN(num) && val !== '') { result[key] = num; continue; }
    result[key] = val;
  }
  return result;
}

/**
 * Read config.yaml if it exists. Returns an empty object on any error.
 * @returns {Object}
 */
function readYaml() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return parseFlatYaml(raw);
  } catch {
    return {};
  }
}

/**
 * Read config.json (written by scripts/config.js, keys spelled with dashes)
 * if it exists. Returns an empty object on any error, so a missing, unreadable
 * or non-JSON file can never break a hook.
 * @returns {Object}
 */
function readJson() {
  try {
    // config.json is written by scripts/config.js but also hand-edited; a UTF-8
    // BOM (PowerShell 5.1, Notepad) used to make JSON.parse throw, so the whole
    // file was silently ignored ({} = every key back to its default).
    const parsed = JSON.parse(fs.readFileSync(CONFIG_JSON_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Load and resolve configuration.
 * Priority for each key: env var > config.yaml > config.json > default.
 * @returns {Object}
 */
function loadConfig() {
  const yaml = readYaml();
  const json = readJson();

  // Helper: resolve a key with optional env var
  function resolve(key, envVar, coerce) {
    if (envVar && process.env[envVar] !== undefined) {
      return coerce(process.env[envVar]);
    }
    if (key in yaml) return yaml[key];
    // The CLI stores dashed keys; config.yaml keys are underscored.
    const dashed = key.replace(/_/g, '-');
    if (dashed in json) return json[dashed];
    if (key in json) return json[key];
    return DEFAULTS[key];
  }

  return {
    plan:                  resolve('plan',                  'TOKEN_WATCH_PLAN',           String),
    context_window:        resolve('context_window',        'TOKEN_WATCH_CONTEXT_WINDOW', Number),
    session_cap:           resolve('session_cap',           'TOKEN_WATCH_SESSION_CAP',    Number),
    weekly_cap:            resolve('weekly_cap',            'TOKEN_WATCH_WEEKLY_CAP',     Number),
    compact_pct:           resolve('compact_pct',           'TOKEN_WATCH_COMPACT_PCT',    Number),
    loop_pct:              resolve('loop_pct',              'TOKEN_WATCH_LOOP_PCT',       Number),
    quota_alert_pct:       resolve('quota_alert_pct',       'TOKEN_WATCH_QUOTA_ALERT_PCT', Number),
    pre_compact_pct:       resolve('pre_compact_pct',       'TOKEN_WATCH_PRE_COMPACT_PCT', Number),
    loop_advisor:          process.env.TOKEN_WATCH_LOOP_ADVISOR !== undefined
                             ? process.env.TOKEN_WATCH_LOOP_ADVISOR !== '0'
                             : ('loop_advisor' in yaml ? yaml.loop_advisor : DEFAULTS.loop_advisor),
    tls_strict:            process.env.TOKEN_WATCH_TLS_STRICT !== undefined
                             ? process.env.TOKEN_WATCH_TLS_STRICT === '1'
                             : ('tls_strict' in yaml ? yaml.tls_strict : DEFAULTS.tls_strict),
    show_cache_ttl:        'show_cache_ttl'        in yaml ? yaml.show_cache_ttl        : DEFAULTS.show_cache_ttl,
    cache_warning_seconds: 'cache_warning_seconds' in yaml ? yaml.cache_warning_seconds : DEFAULTS.cache_warning_seconds,
  };
}

module.exports = { loadConfig, CONFIG_PATH, CONFIG_JSON_PATH };
