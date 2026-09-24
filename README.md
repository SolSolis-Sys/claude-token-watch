# claude-token-watch

> Live token, context-window and cost monitoring for Claude Code — statusline gauge, quota alerts, and usage reports. Zero dependencies.

[![CI](https://github.com/SolSolis-Sys/claude-token-watch/actions/workflows/ci.yml/badge.svg)](https://github.com/SolSolis-Sys/claude-token-watch/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-0.3.7-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

> ⚠️ **Alpha — work in progress. Use at your own risk.** Expect rough edges. Found a bug or have a suggestion? Please [open an issue]

> **Not affiliated with Anthropic.** This is an independent, unofficial tool that reads local Claude Code data and Anthropic's public OAuth usage endpoint — not a product of or endorsed by Anthropic.

```
◈ Sonnet 4.6  ▕███████░░░▏ 72% ctx · 144k/200k  ·  $0.42
```

---

## Features

- **Statusline gauge** — real-time context fill % in your terminal (green → yellow → red)
- **Quota alerts** — warns when the 5h session quota crosses a configurable threshold (`quota_alert_pct`, default **90%**), in both interactive and autonomous agent modes
- **Session cost** — running USD cost from transcript data, no token API required
- **Subscription gauges** — live 5h and 7d rolling-window gauges from Anthropic's OAuth endpoint
- **Autonomous mode** — hooks fire on `Stop` events, covering background agents
- **Zero dependencies** — pure Node.js built-ins only

## Install

Everything below is done by **you**, in Claude Code. Installing the plugin does **not** install or patch anything outside your own Claude Code configuration.

### 1. Add the marketplace and install the plugin (recommended)

```bash
# In Claude Code:
/plugin marketplace add SolSolis-Sys/claude-token-watch
/plugin install token-watch@token-watch
```

Then **restart Claude Code**: hooks are loaded from the plugin at session start.

### 2. Verify the plugin is registered

```bash
claude plugin details token-watch@token-watch
```

Expected: the plugin version, plus `Hooks (4)` — `UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionEnd`. No `statusLine` component is listed, because a plugin manifest cannot declare one (see below).

### 3. Enable the statusline gauge

The hooks wire up automatically. The statusline is a **Claude Code setting**, so it is added to `~/.claude/settings.json` — not to the plugin manifest:

**macOS / Linux**
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"$HOME/.claude/plugins/marketplaces/token-watch/statusline/statusline.js\""
  }
}
```

**Windows** (verified form — absolute path, escaped backslashes)
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:\\Users\\<you>\\.claude\\plugins\\marketplaces\\token-watch\\statusline\\statusline.js\""
  }
}
```

Then restart Claude Code so the setting is loaded.

> Or just ask Claude: *"Add the token-watch statusline to my settings.json."*

> **Known limitation.** `statusLine` inside a plugin manifest (`.claude-plugin/plugin.json`) is **not a recognized plugin component** — it never appears in `claude plugin details <plugin>`, and it is not registered by installing the plugin. As of 0.3.7 the manifest no longer declares one, so `settings.json` is the only supported registration path. Even when it is configured correctly, Claude Code 2.1.281 on Windows may leave the statusline blank — that part is an open upstream issue ([#52997](https://github.com/anthropics/claude-code/issues/52997), [#57940](https://github.com/anthropics/claude-code/issues/57940)), not a plugin-side fix. Running the command by hand is the way to tell the two cases apart — see *Troubleshooting a silent hook* below.

### Alternative: clone the repository

```bash
git clone https://github.com/SolSolis-Sys/claude-token-watch ~/.claude/plugins/token-watch
```

A clone alone registers nothing — it is meant for local development and for pointing a marketplace entry at a local path.

## Commands

```bash
/token-report            # today + last 7 days + all-time summary
/token-report today      # just today
/token-report sessions   # recent sessions, newest first
/token-report models     # cost grouped by model
```

Outside Claude Code:

```bash
node scripts/report.js
# or
npx claude-token-watch
```

## Configuration

### Where settings live

The hooks and the statusline read a flat YAML file:

```
~/.claude/token-watch/config.yaml
```

```yaml
quota_alert_pct: 90
loop_pct: 85
```

Precedence for every key: **environment variable > `config.yaml` > `config.json` > built-in default**.

The second file is read as a fallback, with a lower priority than `config.yaml`:

```
~/.claude/token-watch/config.json
```

`token-watch-config` writes it (see *CLI*), with dashed keys (`quota-alert-pct`, `loop-pct`, `compact-pct`, `pre-compact-pct`). A value set through the CLI is therefore really applied by the hooks and the statusline — unless the same key is also present in `config.yaml` or in the environment, which win over it.

Two narrowings of that chain, as implemented:

| Key family | Sources actually read, in order |
|------------|---------------------------------|
| `plan`, `context_window`, `session_cap`, `weekly_cap`, `compact_pct`, `loop_pct`, `quota_alert_pct`, `pre_compact_pct` | environment variable > `config.yaml` (underscored keys) > `config.json` (dashed key, then underscored) > default |
| `loop_advisor`, `tls_strict` | environment variable > `config.yaml` > default — a `config.json` entry for either is ignored |
| `show_cache_ttl`, `cache_warning_seconds` | `config.yaml` > default — no environment variable, not read from `config.json` |

Two different behaviours, depending on who reads:

- **The hooks and the statusline never throw.** For them an absent, unreadable or malformed file simply means the next source applies: a `config.json` that is not valid JSON, a JSON array or `null` is treated as absent, and the defaults apply. A file written UTF-16LE by PowerShell 5.1 (`>` or `Out-File -Encoding unicode`), a truncated file or commented JSON lands in the same bucket — the settings are silently *not* applied, the component still works and still exits 0.
- **`token-watch-config` refuses to work on such a file.** `set` and `get` exit 1, print nothing on stdout, and name the path and the suspected cause on stderr; nothing is written, so the settings still on disk survive. `reset` is the exception — it deletes the file without reading it (see *CLI*).

A threshold that the hook cannot use — text, `NaN`, zero or negative — is normalized back to the default by `loop-advisor.js`, and a value above 100 is clamped to 100; the CLI refuses anything outside `0-99` before it is written.

### Configurable thresholds

| Key | Environment variable | Default | Effect |
|-----|----------------------|---------|--------|
| `quota_alert_pct` | `TOKEN_WATCH_QUOTA_ALERT_PCT` | `90` | 5h quota % that turns the advisory into an explicit quota alert |
| `loop_pct` | `TOKEN_WATCH_LOOP_PCT` | `80` | 5h quota % from which the loop advisor speaks up |
| `compact_pct` | `TOKEN_WATCH_COMPACT_PCT` | `80` | Context-window % that triggers the `/compact` nudge |
| `pre_compact_pct` | `TOKEN_WATCH_PRE_COMPACT_PCT` | `85` | Context-window % for the early pre-compact warning (once per session) |
| `context_window` | `TOKEN_WATCH_CONTEXT_WINDOW` | `0` | Context window size in tokens (`0` = auto from the model family) |
| `session_cap` | `TOKEN_WATCH_SESSION_CAP` | `0` | Token cap of the 5h window (`0` = from the detected plan) |
| `weekly_cap` | `TOKEN_WATCH_WEEKLY_CAP` | `0` | Token cap of the 7d window (`0` = from the detected plan) |
| `plan` | `TOKEN_WATCH_PLAN` | auto | `pro` / `max5` / `max20` — overrides plan auto-detection |
| `loop_advisor` | `TOKEN_WATCH_LOOP_ADVISOR` | `1` | Set to `0` to disable the loop advisor / quota alert hook entirely |
| `tls_strict` | `TOKEN_WATCH_TLS_STRICT` | `0` | `1` = strict TLS, no fallback · `0` = allow unverified chain (corporate proxies) |
| `show_cache_ttl` | — (`config.yaml` only) | `true` | Show the prompt-cache TTL segment in the statusline |
| `cache_warning_seconds` | — (`config.yaml` only) | `60` | Remaining cache TTL below which the countdown turns yellow then red |

`quota_alert_pct` has three entry points: the environment variable, `config.yaml`, and the CLI (`token-watch-config set quota-alert-pct <value>`). All three reach the hook: the CLI writes `config.json`, which `lib/config.js` reads as a fallback below `config.yaml`. The CLI accepts its own dashed spelling and the underscored one (`quota_alert_pct`); both write the same key.

Other environment variables:

| Variable | Default | Effect |
|----------|---------|--------|
| `TOKEN_WATCH_LOOP_IMMINENT_MINS` | `15` | Minutes left before the 5h reset counted as "imminent" |
| `NO_COLOR` | – | Set to disable ANSI colors |

### Which file each component reads

`config.yaml` and `config.json` are **not** the same file — this matters when a threshold you set "does not apply". Per component, in order as implemented:

| Component | Configuration sources, in order |
|-----------|--------------------------------|
| `hooks/loop-advisor.js` (loop advisor + 5h quota alert) | `TOKEN_WATCH_LOOP_PCT` / `TOKEN_WATCH_QUOTA_ALERT_PCT` / `TOKEN_WATCH_LOOP_ADVISOR` > `config.yaml` (`loop_pct`, `quota_alert_pct`, `loop_advisor`) > `config.json` (`loop-pct`, `quota-alert-pct`) > defaults (80 / 90 / on) |
| `statusline/statusline.js` | `TOKEN_WATCH_PLAN` / `_CONTEXT_WINDOW` / `_SESSION_CAP` / `_WEEKLY_CAP` > `config.yaml` > `config.json` > defaults; `show_cache_ttl` and `cache_warning_seconds` come from `config.yaml` only |
| `hooks/context-guard.js` (compact nudges) | `TOKEN_WATCH_COMPACT_PCT` / `TOKEN_WATCH_PRE_COMPACT_PCT` > `config.json` (`compact-pct`, `pre-compact-pct`) > defaults (80 / 85) |

Every component that reads `config.yaml` goes through `lib/config.js`, which also reads `config.json` as a fallback — so a value written by `token-watch-config` applies to the quota alert and to the statusline, not only to `context-guard.js`. For the same key, `config.yaml` wins over `config.json`. `context-guard.js` is the one component that reads `config.json` alone: put `compact-pct` / `pre-compact-pct` there, or set its environment variables.

### CLI

```bash
token-watch-config set compact-pct 90         # suggest /compact at 90% context fill
token-watch-config set pre-compact-pct 80     # early warning before the hard threshold
token-watch-config set loop-pct 85            # loop advisory at 85% of the 5h quota
token-watch-config set quota-alert-pct 90     # 5h quota alert threshold (also `quota_alert_pct`)
token-watch-config get                        # show current effective settings
token-watch-config get quota-alert-pct        # show one key
token-watch-config reset                      # restore built-in defaults
```

Keys are accepted with dashes (`quota-alert-pct`, the CLI spelling) or underscores (`quota_alert_pct`, the `config.yaml` spelling); either way `set` stores one canonical dashed key in `config.json`. `set` validates the value (`0-99` — `100`, `-1` and text are refused with a non-zero exit and nothing is written) and `get` reports the effective value with the environment variable winning. The four keys above are the only ones accepted; anything else is refused.

Both need to read the file first, so a `config.json` that is present but is not a UTF-8 JSON object is **not** treated as "no settings". The CLI exits 1, stdout stays empty, and stderr names the file and the suspected cause:

```text
$ token-watch-config get          # exit 1, stdout empty
token-watch: C:\Users\you\.claude\token-watch\config.json is present but unreadable — it is not UTF-8 but UTF-16LE (BOM FF FE).
token-watch: refusing to overwrite it; no modification was made.
token-watch: it must be a UTF-8 JSON object — fix it or delete it, then retry.
```

`set` is refused the same way (same exit 1, same three lines, file untouched) instead of overwriting it with an empty object — which is how settings used to be lost. A truncated file reports `invalid JSON (Expected ',' or '}' after property value …)`, commented JSON `invalid JSON (Expected property name or '}' …)`, and a non-object root `invalid — the root is a JSON array, not an object` (or `… the root is null, not an object`); the positions Node quotes depend on the file contents.

`reset` is the exception: it restores the built-in defaults by **deleting** `config.json` without reading it. On a UTF-16LE, truncated or commented file it therefore succeeds — exit 0, `Deleted: <path>` — and whatever was stored there is discarded with no warning about the contents, where a `get` on that same file exits 1. Use `reset` when you want the file gone, not when you want to know what it said.

A file the CLI refuses is not fatal for the plugin: the hooks and the statusline keep working from `config.yaml` and the defaults (see *Where settings live*).

What the CLI writes is picked up by the hooks and the statusline, because `lib/config.js` reads `config.json` as a fallback below `config.yaml` — and the environment still wins over both (see *Where settings live*).

## Hooks

token-watch registers these Claude Code hooks automatically. Each entry is one command from `hooks/hooks.json`, mirrored in `.claude-plugin/plugin.json`:

| Event | File | Purpose |
|-------|------|---------|
| `UserPromptSubmit` | `loop-advisor.js` | 5h quota advisory / quota alert before each prompt |
| `PostToolUse` | `metrics-writer.js` | Refresh the metrics snapshot while work is in progress |
| `Stop` | `context-guard.js` | Pre-compact warning at 85% (once/session) + hard nudge at 80% |
| `Stop` | `metrics-writer.js` | Write the end-of-turn metrics snapshot for conductor |
| `Stop` | `loop-advisor.js` | 5h quota advisory / quota alert in autonomous mode |
| `SessionEnd` | `session-logger.js` | Log session usage to JSONL |

### Why the hook commands look unusual

Every command has this shape — this is the exact text stored in `hooks/hooks.json`:

```
node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','loop-advisor.js')).main()"
```

Two details carry the whole thing:

- **The path is resolved inside Node.** The plugin root is read from the `CLAUDE_PLUGIN_ROOT` environment variable, so no shell ever has to expand a path. The previous form — `node "${CLAUDE_PLUGIN_ROOT}/hooks/loop-advisor.js"` — was silent on Windows: `cmd.exe` does not expand `${VAR}`, and shells that did expand it lost the backslashes of a Windows root (turning `C:\Users\you\.claude\…` into `C:Usersyou.claude…`). Both failure modes produced `Cannot find module …` on stderr, exit code 1 and empty stdout.
- **The trailing `.main()` is required.** Under `node -e` there is no entry module, so `require.main` is `undefined`; the guard `if (require.main === module) main();` that every hook keeps is therefore false, and a bare `require(…)` loads the module without ever running it. That form still exits 0 with no output and no effect — the worst kind of failure, because nothing looks broken. `metrics-writer.js`, whose entry is async, is called as `.main().catch(() => process.exit(0))` so a rejection cannot surface as an unhandled rejection or a non-zero exit.

When `quota_alert_pct` is crossed, the advisory becomes an explicit quota alert; it is re-emitted at most every 30 minutes per session, and a threshold crossing always goes through. The cooldown state lives in `~/.claude/token-watch/loop-advisor-last.json` as `{ sessionId, ts, pct }`.

## Troubleshooting a silent hook

A hook that prints nothing is not always broken: `loop-advisor.js` is silent when the 5h usage is below both thresholds, and `metrics-writer.js` writes a file and prints nothing at all. But a silent hook is not healthy either — **the only proof a hook works is an observable effect** (a file rewritten, a JSON line on stdout, a state file updated). An exit code of 0 with empty stdout and no effect is exactly what a mute hook produces. Follow the steps in order.

1. **Is the hook registered?**

   ```bash
   claude plugin details token-watch@token-watch
   ```

   Expect `Hooks (4)`. If the hooks are missing, the plugin is not installed or not loaded — reinstall it and restart Claude Code.

2. **Does the command produce an observable effect?** Set the plugin root and run the command from `hooks/hooks.json` verbatim, under `cmd.exe`:

   ```bat
   set CLAUDE_PLUGIN_ROOT=C:\Users\<you>\.claude\plugins\marketplaces\token-watch
   echo {"session_id":"diag"} | node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','loop-advisor.js')).main()"
   ```

   PowerShell equivalent:

   ```powershell
   $env:CLAUDE_PLUGIN_ROOT = "C:\Users\<you>\.claude\plugins\marketplaces\token-watch"
   '{"session_id":"diag"}' | node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','loop-advisor.js')).main()"
   ```

   **The exit code tells you nothing here, and empty stdout on its own tells you nothing either** — the broken dispatch form used to exit 0 with no output while doing strictly nothing. What counts is the effect: this command prints a JSON line when the 5h usage is at or above `min(loop_pct, quota_alert_pct)`, and stays silent below it, which is the correct answer rather than a fault — in that case verify another hook's effect instead (step 3). `Cannot find module …` means the plugin is outdated (the old `${CLAUDE_PLUGIN_ROOT}` string form) or the literal root is wrong; a mangled path such as `C:Usersyou…` means the backslashes were eaten by the shell.

3. **Is the metrics snapshot being refreshed?** `metrics-writer.js` never prints anything, so its stdout is always empty — this timestamp is the only evidence that it ran. After any tool call in a session, `metrics.json` must have a fresh mtime:

   ```powershell
   Get-Item "$env:USERPROFILE\.claude\token-watch\metrics.json" | Select-Object LastWriteTime, Length
   ```

   A timestamp that stops moving while the session is active means the hook never ran — go back to step 2 and check the trailing `.main()` in the command.

4. **Is the usage cache valid?** The quota alert reads it and never calls the network:

   ```powershell
   Get-Content "$env:USERPROFILE\.claude\token-watch\usage-cache.json" | ConvertFrom-Json |
     Select-Object fetchedAt, @{n='session5hPct';e={$_.data.session5hPct}}
   ```

   `fetchedAt` must be a number, and `data.session5hPct` a number between 0 and 1. A missing or corrupt cache is not an error — it simply makes the hook silent.

5. **Are the thresholds reached?** The alert needs `session5hPct >= min(loop_pct, quota_alert_pct)`.

   ```powershell
   Get-Content "$env:USERPROFILE\.claude\token-watch\config.yaml" -ErrorAction SilentlyContinue
   Get-Content "$env:USERPROFILE\.claude\token-watch\config.json" -ErrorAction SilentlyContinue
   node -e "console.log(require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'lib','config.js')).loadConfig())"
   ```

   `loadConfig()` prints the values the hooks and the statusline really use, so it is the authority here: the environment wins over `config.yaml`, which wins over `config.json`, which wins over the defaults. A crossing that was already reported within the last 30 minutes is throttled; the state is visible in `loop-advisor-last.json`.

6. **Reproduce with a real payload, then look for the effect.** Feed the hook the JSON Claude Code sends (a `session_id`, and a `transcript_path` for `context-guard.js` and `session-logger.js`) and check what changed rather than the exit code: `loop-advisor.js` prints its advisory JSON on stdout, `metrics-writer.js` rewrites `metrics.json`, `session-logger.js` appends a line to `usage.jsonl`, `context-guard.js` prints a `systemMessage` when the context crosses the hard threshold, and its once-per-session pre-compact warning both prints and records itself in `precompact-state.json` (a second run on the same transcript is legitimately silent). A hook that exits 0 and neither prints nor touches anything is the mute-hook failure described above, not a passing run.

## Development

```bash
npm test    # node test/smoke.js && node --test "test/*.test.js"
```

Some tests start child processes to exercise the hook commands end to end. In a restricted sandbox those spawns fail with `spawn EPERM` — that is an environment limitation, not a plugin failure.

## How it works

Claude Code writes a JSONL transcript per session under `~/.claude/projects/<project>/<session>.jsonl`. Each assistant turn records the real token usage — token-watch reads these files locally. The one live call is to Anthropic's OAuth usage endpoint for subscription gauges (read-only, cached 60s, the OAuth token is never logged); the quota alert hook never calls it, it only reads the disk cache. An unreadable transcript or cache degrades to "no output", never to an error.

## Ecosystem

- **[claude-conductor](https://github.com/SolSolis-Sys/claude-conductor)** — reads token-watch metrics for autonomous context management (`/compact` at 90%)
- **[conductor-blueprints](https://github.com/SolSolis-Sys/conductor-blueprints)** — community blueprint library with cost profiles powered by token-watch data

## Prompt for your AI agent

Copy and paste this prompt to have your AI assistant install token-watch automatically:

```
Please install the claude-token-watch plugin for Claude Code.
1. Run in Claude Code: /plugin marketplace add SolSolis-Sys/claude-token-watch
2. Then: /plugin install token-watch@token-watch
3. Add the statusLine to ~/.claude/settings.json:
   { "statusLine": { "type": "command", "command": "node \"$HOME/.claude/plugins/marketplaces/token-watch/statusline/statusline.js\"" } }
   On Windows use the absolute path with escaped backslashes:
   { "statusLine": { "type": "command", "command": "node \"C:\\Users\\<you>\\.claude\\plugins\\marketplaces\\token-watch\\statusline\\statusline.js\"" } }
4. Restart Claude Code to activate the hooks.
5. Verify with: claude plugin details token-watch@token-watch  (expect Hooks (4))
```

---

*Built with [Claude](https://claude.ai) (Anthropic) — AI pair programming.*

## License

MIT © [SolSolis-Sys](https://github.com/SolSolis-Sys)
