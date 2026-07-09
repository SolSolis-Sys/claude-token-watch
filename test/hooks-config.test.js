#!/usr/bin/env node
"use strict";

// Zero-framework config test: verifies hooks/hooks.json and .claude-plugin/plugin.json
// each have a PostToolUse group with metrics-writer.js, and existing groups unchanged.

const fs = require("fs");
const path = require("path");

const assert = require("assert");

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("  OK " + name);
}

const repoRoot = path.resolve(__dirname, "..");

console.log("\nhooks-config test\n");

// --- Load both configs ---
const hooksRaw = fs.readFileSync(path.join(repoRoot, "hooks", "hooks.json"), "utf8");
const pluginRaw = fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8");

const hooksCfg = JSON.parse(hooksRaw);
const pluginCfg = JSON.parse(pluginRaw);

// --- Baseline counts (pre-change) ---
const BASELINE = { Stop: 3, UserPromptSubmit: 1, SessionEnd: 1 };

// --- Test helpers ---
function checkConfig(label, cfg) {
  const h = cfg.hooks;
  if (!h) throw new Error(label + ": missing .hooks");

  // Existing groups unchanged
  for (const [group, expected] of Object.entries(BASELINE)) {
    ok(label + " " + group + " has " + expected + " entries", () => {
      assert.ok(Array.isArray(h[group]), label + ": " + group + " missing");
      assert.strictEqual(h[group].length, expected, label + ": " + group + " count mismatch");
    });
  }

  // PostToolUse exists
  ok(label + " has PostToolUse group", () => {
    assert.ok(Array.isArray(h.PostToolUse), label + ": PostToolUse missing or not array");
  });

  // PostToolUse contains metrics-writer.js
  ok(label + " PostToolUse contains metrics-writer.js", () => {
    const found = h.PostToolUse.some((entry) => {
      if (!entry.hooks || !Array.isArray(entry.hooks)) return false;
      return entry.hooks.some((hook) => {
        return hook.command && hook.command.includes("metrics-writer.js");
      });
    });
    assert.ok(found, label + ": metrics-writer.js not found in PostToolUse");
  });

  // PostToolUse does NOT contain context-guard.js or loop-advisor.js
  ok(label + " PostToolUse does NOT contain context-guard.js", () => {
    const found = h.PostToolUse.some((entry) => {
      if (!entry.hooks || !Array.isArray(entry.hooks)) return false;
      return entry.hooks.some((hook) => {
        return hook.command && hook.command.includes("context-guard.js");
      });
    });
    assert.ok(!found, label + ": context-guard.js should not be in PostToolUse");
  });

  ok(label + " PostToolUse does NOT contain loop-advisor.js", () => {
    const found = h.PostToolUse.some((entry) => {
      if (!entry.hooks || !Array.isArray(entry.hooks)) return false;
      return entry.hooks.some((hook) => {
        return hook.command && hook.command.includes("loop-advisor.js");
      });
    });
    assert.ok(!found, label + ": loop-advisor.js should not be in PostToolUse");
  });
}

// --- Run checks ---
checkConfig("hooks.json", hooksCfg);
checkConfig("plugin.json", pluginCfg);

console.log("\n" + passed + " checks passed.");