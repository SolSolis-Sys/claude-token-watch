#!/usr/bin/env node
'use strict';

/**
 * SessionEnd hook — appends an aggregated usage record for the finished
 * session to ~/.claude/token-watch/usage.jsonl. This is what powers the
 * cross-session history in `/token-report` (transcripts can be pruned;
 * this log is durable and tiny: one line per session).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readTranscript, aggregate } = require('../lib/transcript');
const { detectPlan, planCacheStale } = require('../lib/subscription');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function dataDir() {
  return path.join(os.homedir(), '.claude', 'token-watch');
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin() || '{}'); } catch { input = {}; }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  const records = readTranscript(transcriptPath);
  if (records.length === 0) process.exit(0);

  const t = aggregate(records);
  const entry = {
    ts: new Date().toISOString(),
    session: input.session_id || path.basename(transcriptPath, '.jsonl'),
    cwd: input.cwd || null,
    reason: input.reason || null,
    messages: t.messages,
    input: t.input,
    output: t.output,
    cacheRead: t.cacheRead,
    cacheWrite: t.cacheWrite,
    cost: Number(t.cost.toFixed(6)),
    models: t.models,
  };

  try {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'usage.jsonl'), JSON.stringify(entry) + '\n');
  } catch {
    // Never fail a session over telemetry.
  }

  // Auto-detect the subscription plan (Pro/Max) at most once per TTL, so the
  // statusline can show real % gauges without the user setting anything.
  try {
    if (planCacheStale()) detectPlan();
  } catch {
    // Plan detection is best-effort; never fail a session over it.
  }

  process.exit(0);
}

main();
