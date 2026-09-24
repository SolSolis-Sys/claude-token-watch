'use strict';

/**
 * Manual probe: runs the Stop hook context-guard against a real transcript
 * with a deliberately low threshold so it always fires. Run:
 *   TOKEN_WATCH_PROBE_ALLOW_REAL_HOME=1 node test/guard-probe.js
 */

// This probe works on the REAL ~/.claude: the hook it spawns writes
// ~/.claude/token-watch/precompact-state.json. Refuse to run without an
// explicit opt-in. This guard sits above every require and every call, so
// nothing can reach the real home when it fires.
if (process.env.TOKEN_WATCH_PROBE_ALLOW_REAL_HOME !== '1') {
  process.stderr.write(
    'test/guard-probe.js writes to the real ~/.claude (precompact-state.json).\n' +
    'Refusing to run. Set TOKEN_WATCH_PROBE_ALLOW_REAL_HOME=1 to allow it.\n'
  );
  process.exit(1);
}

const { spawnSync } = require('child_process');
const path = require('path');
const { allTranscripts } = require('../lib/transcript');

const files = allTranscripts();
if (files.length === 0) { console.log('No transcripts.'); process.exit(0); }

const payload = JSON.stringify({
  session_id: 'probe',
  transcript_path: files[0].file,
  hook_event_name: 'Stop',
});

const r = spawnSync('node', [path.join(__dirname, '..', 'hooks', 'context-guard.js')], {
  input: payload,
  encoding: 'utf8',
  env: { ...process.env, TOKEN_WATCH_COMPACT_PCT: '5' }, // force fire
});

console.log('GUARD OUTPUT:', r.stdout || '(empty)');
