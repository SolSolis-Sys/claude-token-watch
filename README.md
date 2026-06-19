<div align="center">

# token-watch

**Live token, context-window, and cost monitoring for [Claude Code](https://claude.com/claude-code).**

A statusline gauge, auto-compact nudges, and a usage report — zero dependencies, ~400 lines of plain Node.

[![License: MIT](https://img.shields.io/badge/License-MIT-2ECC71.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3498DB.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-E74C3C.svg)](package.json)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-555555.svg)](#install)

</div>

> **Alpha — work in progress. Use at your own risk.** Expect rough edges. Found a bug or have a suggestion? Please [open an issue](https://github.com/SolSolis-Sys/claude-token-watch/issues).

> **Not affiliated with Anthropic.** This is an independent, unofficial tool that reads local Claude Code data and Anthropic's public OAuth usage endpoint (see [How it works](#how-it-works)) — not a product of or endorsed by Anthropic.

---

```
◈ Sonnet 4.6  ▕███████░░░▏ 72% ctx · 144k/200k  ·  $0.42
```

*Your statusline, now telling you how full your context is and what the session is costing — at a glance, on every turn.*

---

## Why

Claude Code is powerful, but it's easy to lose track of two things:

1. **How much of your context window is left** before quality degrades or an auto-compact surprises you.
2. **What a session actually costs.**

`token-watch` surfaces both, mostly from data Claude Code already produces locally. The one exception is the subscription gauges, which read your real `/usage` percentage from Anthropic's OAuth endpoint — nothing is ever logged or sent elsewhere.

## Features

| Feature | Description |
|---|---|
| **Statusline gauge** | Live model, context-window fill bar (green → yellow → red), and session cost. |
| **Auto-compact nudge** | When context crosses a threshold (default 80%), a one-line message suggests `/compact`. Never blocks. |
| **Loop advisor** | Before each prompt, warns when the 5h quota is high (default 80%) — tells autonomous loops how long until reset so they can defer long tasks gracefully. |
| **`/token-report`** | Cost and token usage for today, the last 7 days, and all time — plus per-session, per-model, and subscription-window breakdowns. |
| **Subscription gauges** | Inline 5h-session and 7-day-weekly gauges in the statusline. Plan (Pro/Max) is auto-detected from `claude auth status`; caps are tunable. |
| **Durable history** | A tiny one-line-per-session log survives transcript pruning. |
| **Local-first, no telemetry** | Reads `~/.claude/projects/**` transcripts and the statusline payload. The only outbound call is the read-only OAuth `/usage` lookup for the subscription gauges — never logged, never sent anywhere else. |

## How it works

Claude Code writes a JSONL transcript per session under `~/.claude/projects/<project>/<session>.jsonl`.
Each assistant turn records the real token usage:

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 3,
      "output_tokens": 180,
      "cache_read_input_tokens": 0,
      "cache_creation": { "ephemeral_1h_input_tokens": 37268 }
    }
  }
}
```

- The **statusline** computes resident context as `input + cache_read + cache_creation` from the latest turn — exactly what the model held that call.
- The **Stop hook** checks that ratio and nudges you toward `/compact` when it's high.
- The **SessionEnd hook** appends an aggregated record to `~/.claude/token-watch/usage.jsonl`.
- The **5h/7d subscription gauges** read the real `%` from Anthropic's OAuth usage endpoint (`GET https://api.anthropic.com/api/oauth/usage`) — the same source that backs the `/usage` command in Claude Code. The result is cached on disk for 60s (`~/.claude/token-watch/usage-cache.json`) since the statusline is a brand-new process on every render. The OAuth token is read from `~/.claude/.credentials.json` and is never logged or written anywhere.
- **`/token-report`** merges that durable log with live transcripts and prices it using the June 2026 rate card.

No token API is required for cost/context tracking — those are the true counts Claude Code already records locally. The subscription gauges are the one feature that does call a live Anthropic endpoint (read-only, OAuth-authenticated).

---

## Install

### As a Claude Code plugin (recommended)

```sh
# In Claude Code:
/plugin marketplace add SolSolis-Sys/claude-token-watch
/plugin install token-watch@token-watch
```

This wires up the hooks and the `/token-report` command automatically.

> **The statusline gauge requires one extra step.** Claude Code plugins cannot contribute a `statusLine` — that is a user-level setting. Add it once (below), then restart Claude Code.

### Step 2 — enable the statusline gauge

The plugin install drops `statusline.js` under your plugins directory. Point `statusLine` at it in `~/.claude/settings.json` (create the key at the top level, alongside `"model"`):

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

Then **restart Claude Code** — the gauge appears on the next turn.

> **Or just ask Claude to do it.** In Claude Code: *"Add the token-watch statusline to my settings.json and restart."* Claude can locate `plugins/marketplaces/token-watch/statusline/statusline.js`, insert the `statusLine` block, and confirm — no manual JSON editing.

#### Installed from a clone instead of the marketplace?

Point the command at your checkout: `node "/absolute/path/to/claude-token-watch/statusline/statusline.js"`.

---

## Usage

```sh
/token-report            # today + last 7 days + all-time summary
/token-report today      # just today
/token-report sessions   # recent sessions, newest first
/token-report models     # cost grouped by model
```

Outside Claude Code it also runs standalone:

```sh
node scripts/report.js
# or, once published:
npx claude-token-watch
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `TOKEN_WATCH_COMPACT_PCT` | `80` | Context fill % that triggers the `/compact` nudge. |
| `TOKEN_WATCH_LOOP_PCT` | `80` | 5h quota % that triggers the loop advisor warning. |
| `TOKEN_WATCH_LOOP_ADVISOR` | _(unset)_ | Set to `0` to disable the loop advisor hook entirely. |
| `TOKEN_WATCH_CONTEXT_WINDOW` | _(model-derived)_ | Override context window size (tokens) for the statusline gauge. |
| `TOKEN_WATCH_PLAN` | _(auto-detected)_ | `pro` \| `max5` \| `max20`. Selects the cap presets for the 5h/7d gauges. Overrides auto-detection. |
| `TOKEN_WATCH_SESSION_CAP` | _(from plan)_ | Token cap for the 5-hour rolling window. Overrides the plan preset. |
| `TOKEN_WATCH_WEEKLY_CAP` | _(from plan)_ | Token cap for the 7-day rolling window. Overrides the plan preset. |
| `TOKEN_WATCH_TLS_STRICT` | _(unset)_ | `1` = enforce strict TLS, never retry without verification (recommended for audited/production environments). `0` = explicitly allow unverified TLS (useful for corporate proxies). Default (unset): if the TLS chain fails, one retry without verification is attempted, with a one-time stderr warning. |
| `NO_COLOR` | – | Set to disable ANSI colors. |

### Subscription gauges (5h / 7d)

The statusline shows two rolling-window gauges — `5h ▕███░░▏ 67%` and `7d ▕█████▏ 91%` — for the Anthropic session and weekly limits.

- **Real percentage, read live.** token-watch calls Anthropic's OAuth usage endpoint (`GET https://api.anthropic.com/api/oauth/usage`, Bearer token from `~/.claude/.credentials.json`) — the same source behind the `/usage` command in Claude Code. The result is the actual `five_hour.utilization` / `seven_day.utilization` percentage, cached on disk for 60s. The OAuth token is never logged or written anywhere.
- **No heuristic fallback.** If the API is unreachable (rate-limited, offline, timeout, no credentials), token-watch first serves the last known real value from the disk cache, even if stale. If no cached real value exists, the gauges are simply omitted — no estimated data is shown. Estimated numbers would mislead more than showing nothing.
- **API unavailable error.** When no data can be served (API down, TLS failure, missing credentials), `/token-report` prints a clear error:
  ```
  ⚠  API live unavailable (network/TLS/auth error). No subscription data shown.
  ```

### TLS troubleshooting (Windows / corporate proxy)

On Windows, Node.js may fail to verify Anthropic's TLS chain (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) because its bundled OpenSSL does not use the OS certificate store. A one-time stderr warning is emitted and the request is retried without TLS verification — the successful result is cached so future fetches skip the doomed strict attempt.

| Value | Behavior |
|---|---|
| `TOKEN_WATCH_TLS_STRICT=1` | Enforce strict TLS, never retry without verification. Recommended for audited/production environments. |
| `TOKEN_WATCH_TLS_STRICT=0` | Explicitly allow unverified TLS. Useful for corporate proxies. |
| _(unset)_ | Try strict first, fall back to unverified on TLS chain error, emit a one-time warning. |

If the API is still unavailable after TLS handling, no data is shown — there is no heuristic estimate.

Pricing lives in [`lib/pricing.js`](lib/pricing.js) and is matched by model-family substring, so new point releases inherit the right rates automatically. Plan caps live in [`lib/subscription.js`](lib/subscription.js).

---

## Project layout

```
.claude-plugin/    plugin.json + marketplace.json
statusline/        statusline.js        — live context/cost gauge
hooks/             context-guard.js     — Stop: /compact nudge
                   session-logger.js    — SessionEnd: durable usage log
commands/          token-report.md      — /token-report slash command
scripts/           report.js            — report engine (also npx-able)
lib/               pricing.js, transcript.js, format.js
test/              smoke.js + probes
```

## Development

```sh
node test/smoke.js              # pure-logic checks (no network, no fixtures)
node test/statusline-probe.js   # render the gauge against your latest transcript
node test/guard-probe.js        # fire the compact nudge
```

## Caveats

- Costs are **client-side estimates** from public rates — treat them as a guide, not a bill.
- Live context is read from the latest assistant turn; right after `/compact` it updates on the next turn.
- Non-Claude models seen in transcripts (e.g. via other harnesses) fall back to Sonnet-class pricing.

---

## Ecosystem

Token Watch integrates with other tools in the SolSolis stack:

- **[claude-conductor](https://github.com/SolSolis-Sys/claude-conductor)** — Orchestration plugin that reads token-watch metrics to automatically suggest `/compact` when context exceeds 90%. Install both for a full autonomous monitoring setup.
- **[conductor-blueprints](https://github.com/SolSolis-Sys/conductor-blueprints)** — Community blueprint library. Blueprints include cost profiles powered by token-watch data.

---

## License

[MIT](LICENSE) © 2026 SolSolis-Sys

<div align="center"><sub>Built with Claude Code · part of the SolSolis toolset</sub></div>
