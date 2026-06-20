# claude-token-watch

> Live token, context-window and cost monitoring for Claude Code — statusline gauge, quota alerts, and usage reports. Zero dependencies.

[![CI](https://github.com/SolSolis-Sys/claude-token-watch/actions/workflows/ci.yml/badge.svg)](https://github.com/SolSolis-Sys/claude-token-watch/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-0.3.4-blue)
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
- **Quota alerts** — warns when 5h session quota exceeds threshold (interactive + autonomous agent modes)
- **Session cost** — running USD cost from transcript data, no token API required
- **Subscription gauges** — live 5h and 7d rolling-window gauges from Anthropic's OAuth endpoint
- **Autonomous mode** — hooks fire on `Stop` events, covering background agents
- **Zero dependencies** — pure Node.js built-ins only

## Install

### Via Claude Code marketplace (recommended)

```bash
# In Claude Code:
/plugin marketplace add SolSolis-Sys/claude-token-watch
/plugin install token-watch@token-watch
```

### Via git clone

```bash
git clone https://github.com/SolSolis-Sys/claude-token-watch ~/.claude/plugins/token-watch
```

### Enable the statusline gauge

The hooks wire up automatically. The statusline requires one extra step — add it to `~/.claude/settings.json`:

**macOS / Linux**
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"$HOME/.claude/plugins/marketplaces/token-watch/statusline/statusline.js\""
  }
}
```

**Windows**
```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:\\Users\\<you>\\.claude\\plugins\\marketplaces\\token-watch\\statusline\\statusline.js\""
  }
}
```

Then restart Claude Code. The gauge appears on the next turn.

> Or just ask Claude: *"Add the token-watch statusline to my settings.json."*

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

| Variable | Default | Description |
|----------|---------|-------------|
| `TOKEN_WATCH_COMPACT_PCT` | `80` | Context % to trigger /compact nudge |
| `TOKEN_WATCH_LOOP_PCT` | `80` | 5h quota % to trigger loop advisor |
| `TOKEN_WATCH_LOOP_ADVISOR` | `1` | Set to `0` to disable loop advisor |
| `TOKEN_WATCH_PLAN` | auto | `pro` / `max5` / `max20` — overrides auto-detection |
| `TOKEN_WATCH_TLS_STRICT` | unset | `1` = strict TLS · `0` = allow unverified (corporate proxies) |
| `NO_COLOR` | – | Set to disable ANSI colors |

## Hooks

token-watch registers the following Claude Code hooks automatically:

| Hook | File | Purpose |
|------|------|---------|
| `UserPromptSubmit` | `loop-advisor.js` | 5h quota advisory before each prompt |
| `Stop` | `context-guard.js` | /compact suggestion when context > 80% |
| `Stop` | `metrics-writer.js` | Write metrics snapshot for conductor |
| `Stop` | `loop-advisor.js` | 5h quota advisory in autonomous mode |
| `SessionEnd` | `session-logger.js` | Log session usage to JSONL |

## How it works

Claude Code writes a JSONL transcript per session under `~/.claude/projects/<project>/<session>.jsonl`. Each assistant turn records the real token usage — token-watch reads these files locally. The one live call is to Anthropic's OAuth usage endpoint for subscription gauges (read-only, cached 60s, the OAuth token is never logged).

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
4. Restart Claude Code to activate the hooks.
```

---

*Built with [Claude](https://claude.ai) (Anthropic) — AI pair programming.*

## License

MIT © [SolSolis-Sys](https://github.com/SolSolis-Sys)
