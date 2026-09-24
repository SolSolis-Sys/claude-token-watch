#!/usr/bin/env node
"use strict";

// Zero-framework config test: verifies hooks/hooks.json and .claude-plugin/plugin.json
// each have a PostToolUse group with metrics-writer.js, and existing groups unchanged.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const assert = require("assert");

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("  OK " + name);
}

const repoRoot = path.resolve(__dirname, "..");

// The real hooks resolve ~/.claude at load time (lib/usage-api, context-guard,
// session-logger, metrics-writer). Divert HOME/USERPROFILE to a throwaway dir
// BEFORE anything requires them, so this test can never read or write the
// user's real installation.
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tw-hooks-home-"));
process.env.HOME = TEST_HOME;
process.env.USERPROFILE = TEST_HOME;

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

// =========================================================================
// H1 — Windows-safe hook dispatch.
// The old form `node "${CLAUDE_PLUGIN_ROOT}/hooks/x.js"` depends on the
// textual substitution preserving backslashes; the substitution strips them
// (`node "C:Userscarmahooks/x.js"` -> MODULE_NOT_FOUND, silent failure).
// The commands must instead read the env var inside Node, which is immune to
// that substitution.
// =========================================================================

// Event -> ordered list of scripts it must dispatch.
const DISPATCH = {
  UserPromptSubmit: ["loop-advisor.js"],
  PostToolUse: ["metrics-writer.js"],
  Stop: ["context-guard.js", "metrics-writer.js", "loop-advisor.js"],
  SessionEnd: ["session-logger.js"],
};

function commandsOf(cfg, event) {
  return (cfg.hooks[event] || []).flatMap((entry) =>
    (entry.hooks || []).map((hook) => hook.command)
  );
}

function scriptOf(command) {
  const m = String(command).match(/(loop-advisor|metrics-writer|context-guard|session-logger)\.js/);
  return m ? m[0] : null;
}

ok("hook commands never use the ${CLAUDE_PLUGIN_ROOT} text substitution", () => {
  for (const [event, scripts] of Object.entries(DISPATCH)) {
    for (const command of commandsOf(hooksCfg, event)) {
      assert.ok(
        !command.includes("${CLAUDE_PLUGIN_ROOT}"),
        event + ": command still relies on the substitution: " + command
      );
      assert.ok(
        command.includes("process.env.CLAUDE_PLUGIN_ROOT"),
        event + ": command must read CLAUDE_PLUGIN_ROOT from the environment: " + command
      );
    }
  }
});

// F1 — under `node -e` there is no require.main, so a hook whose entry only ran
// behind `if (require.main === module)` was silently dead. Every command must
// therefore call the exported entry explicitly.
ok("every hook command calls the exported entry explicitly", () => {
  for (const [event, scripts] of Object.entries(DISPATCH)) {
    for (const command of commandsOf(hooksCfg, event)) {
      assert.ok(
        command.includes(".main()"),
        event + ": command never calls the exported main(): " + command
      );
      assert.ok(
        !command.includes("require.main"),
        event + ": command still relies on require.main: " + command
      );
      if (scriptOf(command) === "metrics-writer.js") {
        assert.ok(
          command.includes(".catch(") && command.includes("process.exit(0)"),
          event + ": async main() must be caught so a rejection cannot fail the hook: " + command
        );
      }
    }
  }
});

ok("hook dispatch targets the expected scripts per event", () => {
  for (const [event, scripts] of Object.entries(DISPATCH)) {
    const found = commandsOf(hooksCfg, event).map(scriptOf);
    assert.deepStrictEqual(found, scripts, event + ": unexpected dispatch order/targets");
  }
});

ok("plugin.json hooks block is strictly equal to hooks/hooks.json hooks", () => {
  if (!pluginCfg.hooks) throw new Error("plugin.json: missing .hooks");
  assert.deepStrictEqual(pluginCfg.hooks, hooksCfg.hooks, "hooks blocks diverged");
});

ok("plugin.json does not declare the unsupported statusLine component", () => {
  assert.strictEqual(pluginCfg.statusLine, undefined, "statusLine is not a plugin component");
});

// --- Execution proof: run every real command against a plugin root whose
// path contains backslashes (the Windows shape that used to be mangled).
const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tw-hookroot-"));
const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-marker-"));
const ALL_SCRIPTS = ["loop-advisor.js", "metrics-writer.js", "context-guard.js", "session-logger.js"];

fs.mkdirSync(path.join(fakeRoot, "hooks"), { recursive: true });
// F2 — the marker must be written BY THE ENTRY, never at require time. A stub
// that marks itself in its module body passes even when the command never calls
// main(); requiring this one is inert, so the marker only appears if the
// command really invoked the exported entry.
for (const script of ALL_SCRIPTS) {
  fs.writeFileSync(
    path.join(fakeRoot, "hooks", script),
    "module.exports = { main: async function () { require(\"fs\").writeFileSync(process.env.TW_HOOK_MARKER, " +
      JSON.stringify(script) +
      "); } };\n"
  );
}

function runHook(command, index) {
  const marker = path.join(markerDir, "m" + index);
  fs.rmSync(marker, { force: true });
  const res = spawnSync(command, {
    shell: true,
    stdio: "ignore", // sandbox forbids piped stdio; exit status + marker are enough
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: fakeRoot, TW_HOOK_MARKER: marker },
  });
  return { status: res.status, content: fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : null };
}

ok("every hook command resolves its script from a backslash-laden plugin root", () => {
  if (process.platform === "win32") {
    assert.ok(fakeRoot.includes("\\"), "test root must contain backslashes: " + fakeRoot);
  }
  let index = 0;
  for (const [event, scripts] of Object.entries(DISPATCH)) {
    const commands = commandsOf(hooksCfg, event);
    assert.strictEqual(commands.length, scripts.length, event + ": command count mismatch");
    scripts.forEach((script, i) => {
      const r = runHook(commands[i], index++);
      assert.strictEqual(r.status, 0, event + " -> " + script + ": command exited " + r.status);
      assert.strictEqual(r.content, script, event + " index " + i + ": wrong script executed");
    });
  }
});

ok("the stub marker proves the entry is called, not that the module was required", () => {
  const stub = path.join(fakeRoot, "hooks", "loop-advisor.js");
  const marker = path.join(markerDir, "require-vs-entry");
  fs.rmSync(marker, { force: true });
  const mod = require(stub);
  assert.ok(!fs.existsSync(marker), "requiring the stub must not write the marker");
  process.env.TW_HOOK_MARKER = marker;
  try {
    mod.main();
  } finally {
    delete process.env.TW_HOOK_MARKER;
  }
  assert.strictEqual(fs.readFileSync(marker, "utf8"), "loop-advisor.js");
});

if (process.platform === "win32") {
  ok("the mangled-root substitution it replaced is proven broken", () => {
    const mangled = fakeRoot.replace(/\\/g, "");
    const res = spawnSync('node "' + mangled + '/hooks/loop-advisor.js"', { shell: true, stdio: "ignore" });
    assert.notStrictEqual(res.status, 0, "mangled root must not resolve");
  });
}

// =========================================================================
// Real hooks, verbatim manifest commands. An exit 0 is not proof: each of the
// four repaired commands must leave an OBSERVABLE effect (stdout JSON or a
// rewritten file). stdout is captured through a file descriptor because the
// agent sandbox refuses piped stdio.
// =========================================================================
const REAL_HOOKS = path.join(repoRoot, "hooks");
const TW_DIR = path.join(TEST_HOME, ".claude", "token-watch");
fs.mkdirSync(TW_DIR, { recursive: true });
// 5h quota at 95 % against the default 90 % alert threshold → loop-advisor must fire.
fs.writeFileSync(
  path.join(TW_DIR, "usage-cache.json"),
  JSON.stringify({ fetchedAt: Date.now(), data: { session5hPct: 0.95, resetsSession: null } })
);
// One real assistant turn: context fill 900 tokens against a 1000-token window.
const TRANSCRIPT = path.join(TW_DIR, "transcript.jsonl");
fs.writeFileSync(
  TRANSCRIPT,
  JSON.stringify({
    type: "assistant",
    timestamp: new Date().toISOString(),
    message: {
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 900, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }) + "\n"
);
const HOOK_STDIN = JSON.stringify({ session_id: "probe", transcript_path: TRANSCRIPT, cwd: repoRoot });
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-hookrun-"));

function treeOf(dir) {
  const out = [];
  (function walk(d) {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  })(dir);
  return out.sort();
}

let runSeq = 0;
function runVerbatim(command, { stdin = "", extraEnv = {} } = {}) {
  const inFile = path.join(runDir, "in" + runSeq + ".txt");
  const outFile = path.join(runDir, "out" + runSeq + ".txt");
  runSeq++;
  fs.writeFileSync(inFile, stdin);
  const inFd = fs.openSync(inFile, "r");
  const outFd = fs.openSync(outFile, "w");
  try {
    const res = spawnSync(command, {
      shell: true,
      stdio: [inFd, outFd, "ignore"],
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot, ...extraEnv },
    });
    return { status: res.status, stdout: fs.readFileSync(outFile, "utf8") };
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
  }
}

ok("all four real hooks export main() and execute nothing at require", () => {
  const before = treeOf(TEST_HOME);
  for (const script of ALL_SCRIPTS) {
    const mod = require(path.join(REAL_HOOKS, script));
    assert.strictEqual(typeof mod.main, "function", script + ": main is not exported");
  }
  assert.deepStrictEqual(treeOf(TEST_HOME), before, "requiring a hook executed it");
});

ok("verbatim UserPromptSubmit command emits the quota alert naming quota_alert_pct", () => {
  const command = commandsOf(hooksCfg, "UserPromptSubmit")[0];
  const r = runVerbatim(command, { stdin: HOOK_STDIN });
  assert.strictEqual(r.status, 0, "exit " + r.status + " for: " + command);
  assert.ok(r.stdout.length > 0, "stdout empty — the hook never ran: " + command);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.ok(ctx.includes("quota_alert_pct"), "advisory must name quota_alert_pct: " + ctx);
  assert.ok(ctx.includes("95%") && ctx.includes("90%"), "advisory must show 95% vs threshold 90%: " + ctx);
  assert.ok(String(out.systemMessage).includes("95%"), "banner: " + out.systemMessage);
});

ok("verbatim PostToolUse command rewrites metrics.json", () => {
  const command = commandsOf(hooksCfg, "PostToolUse")[0];
  const metricsFile = path.join(TW_DIR, "metrics.json");
  fs.writeFileSync(metricsFile, JSON.stringify({ ts: 0, alert: false }));
  const r = runVerbatim(command, { stdin: HOOK_STDIN });
  assert.strictEqual(r.status, 0, "exit " + r.status + " for: " + command);
  const m = JSON.parse(fs.readFileSync(metricsFile, "utf8"));
  assert.notStrictEqual(m.ts, 0, "metrics.json was not rewritten by: " + command);
  assert.strictEqual(m.quota_5h_pct, 0.95, "quota_5h_pct: " + m.quota_5h_pct);
  assert.strictEqual(m.alert, true, "alert flag should follow the 95 % quota: " + m.alert);
});

ok("verbatim Stop command runs context-guard and emits its system message", () => {
  const command = commandsOf(hooksCfg, "Stop")[0];
  const r = runVerbatim(command, {
    stdin: HOOK_STDIN,
    extraEnv: { TOKEN_WATCH_CONTEXT_WINDOW: "1000" },
  });
  assert.strictEqual(r.status, 0, "exit " + r.status + " for: " + command);
  assert.ok(r.stdout.length > 0, "stdout empty — the hook never ran: " + command);
  const out = JSON.parse(r.stdout);
  assert.ok(/context at 90%/.test(out.systemMessage), "systemMessage: " + out.systemMessage);
});

ok("verbatim SessionEnd command appends a usage.jsonl record", () => {
  const command = commandsOf(hooksCfg, "SessionEnd")[0];
  const usageFile = path.join(TW_DIR, "usage.jsonl");
  fs.rmSync(usageFile, { force: true });
  const r = runVerbatim(command, { stdin: HOOK_STDIN });
  assert.strictEqual(r.status, 0, "exit " + r.status + " for: " + command);
  const lines = fs.readFileSync(usageFile, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 1, "usage.jsonl lines: " + lines.length);
  const entry = JSON.parse(lines[0]);
  assert.strictEqual(entry.messages, 1, "messages: " + entry.messages);
  assert.strictEqual(entry.input, 900, "input tokens: " + entry.input);
});

// A hand-edited config.json under PowerShell 5.1 (`Set-Content -Encoding utf8`)
// starts with a UTF-8 BOM. context-guard used to JSON.parse it raw, so the file
// was ignored in complete silence and the thresholds fell back to their defaults
// (80/85). The case needs a real process (the hook reads stdin), hence its place
// here rather than in test/quota-alert.test.js which must stay spawn-free.
ok("a UTF-8 BOM in config.json no longer silences context-guard", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tw-bom-home-"));
  const tw = path.join(home, ".claude", "token-watch");
  fs.mkdirSync(tw, { recursive: true });
  const tr = path.join(tw, "half.jsonl");
  fs.writeFileSync(
    tr,
    JSON.stringify({
      type: "assistant",
      timestamp: new Date().toISOString(),
      message: {
        model: "claude-sonnet-4-5",
        usage: { input_tokens: 500, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }) + "\n"
  );
  const command = commandsOf(hooksCfg, "Stop")[0];
  const extraEnv = { HOME: home, USERPROFILE: home, TOKEN_WATCH_CONTEXT_WINDOW: "1000" };
  const stdin = JSON.stringify({ session_id: "bom", transcript_path: tr, cwd: repoRoot });
  const cfgFile = path.join(tw, "config.json");

  // Control: no config file at all → 50 % is below the 80 % default → mute.
  const bare = runVerbatim(command, { stdin, extraEnv });
  assert.strictEqual(bare.status, 0, "exit " + bare.status + " for: " + command);
  assert.strictEqual(bare.stdout, "", "50 % must stay under the default 80 %: " + bare.stdout);

  // Same threshold, no BOM → unchanged behaviour (the fix is BOM-only).
  fs.writeFileSync(cfgFile, JSON.stringify({ "compact-pct": 40 }));
  const plain = runVerbatim(command, { stdin, extraEnv });
  assert.ok(plain.stdout.includes("context at 50%"), "no-BOM config ignored: " + plain.stdout);

  // PowerShell-written shape: EF BB BF, then the JSON.
  fs.writeFileSync(cfgFile, "\uFEFF" + JSON.stringify({ "compact-pct": 40 }));
  const bytes = fs.readFileSync(cfgFile);
  assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], "fixture lost its BOM");
  const bom = runVerbatim(command, { stdin, extraEnv });
  assert.strictEqual(bom.status, 0, "exit " + bom.status + " for: " + command);
  assert.ok(bom.stdout.length > 0, "config.json with a BOM was silently discarded (hook stayed mute)");
  const msg = JSON.parse(bom.stdout).systemMessage;
  assert.ok(msg.includes("context at 50%"), "the configured 40 % threshold did not fire at 50 %: " + bom.stdout);

  fs.rmSync(home, { recursive: true, force: true });
});

fs.rmSync(fakeRoot, { recursive: true, force: true });
fs.rmSync(markerDir, { recursive: true, force: true });
fs.rmSync(runDir, { recursive: true, force: true });
fs.rmSync(TEST_HOME, { recursive: true, force: true });

console.log("\n" + passed + " checks passed.");