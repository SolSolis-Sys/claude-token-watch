'use strict';

/**
 * Manual probe: runs the Stop hook context-guard against a real transcript
 * with a deliberately low threshold so it always fires. Run:
 *   node test/guard-probe.js
 */

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
