'use strict';

/**
 * Manual probe: feeds the statusline its stdin JSON using a real transcript,
 * so we can eyeball the rendered gauge. Not part of the automated suite.
 * Run: node test/statusline-probe.js
 */

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
