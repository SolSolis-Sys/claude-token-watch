'use strict';

/**
 * Manual probe: feeds the statusline its stdin JSON using a real transcript,
 * so we can eyeball the rendered gauge. Not part of the automated suite.
 * Run: TOKEN_WATCH_PROBE_ALLOW_REAL_HOME=1 node test/statusline-probe.js
 */

// This probe works on the REAL ~/.claude: the statusline it spawns reads
// ~/.claude/.credentials.json and rewrites ~/.claude/token-watch/usage-cache.json.
// Refuse to run without an explicit opt-in. This guard sits above every require
// and every call, so nothing can reach the real home when it fires.
if (process.env.TOKEN_WATCH_PROBE_ALLOW_REAL_HOME !== '1') {
  process.stderr.write(
    'test/statusline-probe.js reads/writes the real ~/.claude (usage-cache.json, .credentials.json).\n' +
    'Refusing to run. Set TOKEN_WATCH_PROBE_ALLOW_REAL_HOME=1 to allow it.\n'
  );
  process.exit(1);
}

const { spawnSync } = require('child_process');
const path = require('path');
const { allTranscripts } = require('../lib/transcript');

const files = allTranscripts();
if (files.length === 0) {
  console.log('No transcripts found to probe.');
  process.exit(0);
}

const payload = JSON.stringify({
  model: { display_name: 'Claude Sonnet 4.6', id: 'claude-sonnet-4-6' },
  transcript_path: files[0].file,
  cost: { total_cost_usd: 0.4231 },
});

const r = spawnSync('node', [path.join(__dirname, '..', 'statusline', 'statusline.js')], {
  input: payload,
  encoding: 'utf8',
});

process.stdout.write('STATUSLINE OUTPUT:\n' + r.stdout + '\n');
if (r.stderr) process.stdout.write('STDERR:\n' + r.stderr + '\n');
