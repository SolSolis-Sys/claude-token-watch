'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { costOf } = require('./pricing');

/** Root of Claude Code project transcripts. */
function projectsRoot() {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** Read a JSONL transcript file and return parsed assistant-usage records. */
function readTranscript(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let j;
    try { j = JSON.parse(s); } catch { continue; }
    if (j.type !== 'assistant' || !j.message || !j.message.usage) continue;
    const usage = j.message.usage;
    const model = j.message.model || 'unknown';
    out.push({
      ts: j.timestamp || null,
      model,
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      // Prefer the structured cache-creation fields (as costOf() does); fall
      // back to the flat field only when the structured ones are absent.
      cacheWrite: (() => {
        const structured =
          (usage.cache_creation &&
            ((usage.cache_creation.ephemeral_5m_input_tokens || 0) +
              (usage.cache_creation.ephemeral_1h_input_tokens || 0))) || 0;
        return structured > 0 ? structured : (usage.cache_creation_input_tokens || 0);
      })(),
      cost: costOf(model, usage),
      usage,
    });
  }
  return out;
}

/** Aggregate a list of records into totals. */
function aggregate(records) {
  const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0, models: {} };
  for (const r of records) {
    t.input += r.input;
    t.output += r.output;
    t.cacheRead += r.cacheRead;
    t.cacheWrite += r.cacheWrite;
    t.cost += r.cost;
    t.messages += 1;
    t.models[r.model] = (t.models[r.model] || 0) + r.cost;
  }
  return t;
}

/** List all transcript files across all projects, newest first. */
function allTranscripts() {
  const root = projectsRoot();
  let projects;
  try { projects = fs.readdirSync(root); } catch { return []; }
  const files = [];
  for (const p of projects) {
    const dir = path.join(root, p);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      if (!e.endsWith('.jsonl')) continue;
      const full = path.join(dir, e);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      files.push({ file: full, mtime: stat.mtimeMs, project: p });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

/** Find the transcript file for a session id (searches all projects). */
function findSession(sessionId) {
  for (const f of allTranscripts()) {
    if (path.basename(f.file, '.jsonl') === sessionId) return f.file;
  }
  return null;
}

module.exports = {
  projectsRoot,
  readTranscript,
  aggregate,
  allTranscripts,
  findSession,
};
