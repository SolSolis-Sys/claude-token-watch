<div align="center">

# 🪙 token-watch

**Live token, context-window & cost monitoring for [Claude Code](https://claude.com/claude-code).**

A statusline gauge, gentle auto-compact nudges, and a usage report — in one tiny plugin.

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-3b82f6.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-e74c3c.svg)](package.json)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-plugin-9b59b6.svg)](#install)

</div>

---

```
◈ Sonnet 4.6  ▕███████░░░▏ 72% ctx · 144k/200k  ·  $0.42
```

> Your statusline, now telling you how full your context is and what the session is costing — at a glance, on every turn.

## Why

Claude Code is powerful, but it's easy to lose track of two things:

1. **How much of your context window is left** before quality degrades or an auto-compact surprises you.
2. **What a session actually costs.**

`token-watch` surfaces both, reads only data Claude Code already produces locally, and **never phones home**. Zero dependencies, ~400 lines of plain Node.

## Features

| | |
|---|---|
| 📊 **Statusline gauge** | Live model, context-window fill bar (green → yellow → red), and session cost. |
| 🧹 **Auto-compact nudge** | When context crosses a threshold (default 80%), a one-line message suggests `/compact`. Never blocks. |
| 🧾 **`/token-report`** | Cost & token usage for today, the last 7 days, and all time — plus per-session, per-model, and subscription-window breakdowns. |
| ⏱️ **Subscription gauges** | Inline 5h-session and 7-day-weekly gauges in the statusline. Plan (Pro/Max) is **auto-detected** from `claude auth status`; caps are tunable. |
| 🗃️ **Durable history** | A tiny one-line-per-session log survives transcript pruning. |
| 🔒 **Local only** | Reads `~/.claude/projects/**` transcripts and the statusline payload. No network, no telemetry. |

## How it works

Claude Code writes a JSONL transcript per session under `~/.claude/projects/<project>/<session>.jsonl`.
Each assistant turn records the **real** token usage:

```json
{ "type": "assistant", "message": { "model": "claude-sonnet-4-6",
  "usage": { "input_tokens": 3, "output_tokens": 180,
             "cache_read_input_tokens": 0,
             "cache_creation": { "ephemeral_1h_input_tokens": 37268 } } } }
```

- The **statusline** computes resident context as `input + cache_read + cache_creation` from the latest turn — exactly what the model held that call.
- The **Stop hook** checks that ratio and nudges you toward `/compact` when it's high.
- The **SessionEnd hook** appends an aggregated record to `~/.claude/token-watch/usage.jsonl`.
- **`/token-report`** merges that durable log with live transcripts and prices it using the June 2026 rate card.

No token API is required — these are the true counts Claude Code already records.

## Install

### As a Claude Code plugin (recommended)

```sh
# In Claude Code:
/plugin marketplace add SolSolis-Sys/claude-token-watch
/plugin install token-watch@token-watch
```

This wires up the **hooks** and the **`/token-report`** command automatically.

> ⚠️ **The statusline gauge is one extra step.** Claude Code plugins cannot
> contribute a `statusLine` — that is a user-level setting. Add it once
> (below), then restart Claude Code.

### Step 2 — enable the statusline gauge

The plugin install drops `statusline.js` under your plugins directory. Point
`statusLine` at it in `~/.claude/settings.json` (create the key at the top
level, alongside `"model"`):

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

> 💡 **Or just ask Claude to do it.** In Claude Code:
> *"Add the token-watch statusline to my settings.json and restart."*
> Claude can locate `plugins/marketplaces/token-watch/statusline/statusline.js`,
> insert the `statusLine` block, and confirm — no manual JSON editing.

#### Installed from a clone instead of the marketplace?

Point the command at your checkout: `node "/absolute/path/to/claude-token-watch/statusline/statusline.js"`.

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

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `TOKEN_WATCH_COMPACT_PCT` | `80` | Context fill % that triggers the `/compact` nudge. |
| `TOKEN_WATCH_CONTEXT_WINDOW` | _(model-derived)_ | Override context window size (tokens) for the statusline gauge. |
| `TOKEN_WATCH_PLAN` | _(auto-detected)_ | `pro` \| `max5` \| `max20`. Selects the cap presets for the 5h/7d gauges. Overrides auto-detection. |
| `TOKEN_WATCH_SESSION_CAP` | _(from plan)_ | Token cap for the 5-hour rolling window. Overrides the plan preset. |
| `TOKEN_WATCH_WEEKLY_CAP` | _(from plan)_ | Token cap for the 7-day rolling window. Overrides the plan preset. |
| `NO_COLOR` | – | Set to disable ANSI colors. |

#### Subscription gauges (5h / 7d)

The statusline shows two rolling-window gauges — `5h ▕███░░▏ 67%` and
`7d ▕█████▏ 91%` — for the Anthropic session and weekly limits.

- **Plan auto-detection.** On `SessionEnd`, token-watch runs `claude auth status
  --json` (reads **only** the `subscriptionType` field — never tokens or email),
  maps it to a plan, and caches the result in
  `~/.claude/token-watch/plan-cache.json` (refreshed at most once per 24h). You
  don't have to configure anything. Set `TOKEN_WATCH_PLAN` to override.
- **The metric** is `input + output + cacheWrite`, **excluding `cache_read`**:
  cache reads are the model re-reading its own resident context each turn and
  dwarf real consumption ~10-50×, which would make the gauge meaningless.
> ### ⚠️ These percentages are estimates, not your exact `/usage`
>
> **Why they don't match Claude's official `/usage` panel exactly:**
> 1. **Anthropic does not publish per-window limits in tokens.** The Pro/Max 5h
>    and weekly caps are not documented as numbers, so the denominators here are
>    community heuristics, not official ceilings.
> 2. **There is no safe way to read the live numbers.** The `/usage` status-bar
>    data comes from an **undocumented** internal endpoint; reverse-engineering it
>    would mean handling your OAuth credentials and is explicitly discouraged
>    (see [anthropics/claude-code#44328](https://github.com/anthropics/claude-code/issues/44328)).
>    `~/.claude/stats-cache.json` only holds message/session counts — no limits.
> 3. **The metric is an approximation.** We count `input + output + cacheWrite`
>    and exclude `cache_read` (context re-reads), which is a *proxy* for real
>    consumption, not Anthropic's exact accounting.
>
> **What we do safely:** auto-detect your *plan* (Pro/Max) from
> `claude auth status` and apply best-effort caps. Treat the gauges as a
> "roughly how heavy is my window" signal, not a billing-accurate figure.
>
> **We're actively studying this.** If a safe, supported way to read the real
> limits appears, we'll calibrate the gauges precisely in a future release. Until
> then you can pin your own caps via `TOKEN_WATCH_SESSION_CAP` /
> `TOKEN_WATCH_WEEKLY_CAP`.

| Plan | `session5h` preset | `weekly` preset | Source |
|---|---|---|---|
| `pro` | `3,500,000` | `90,000,000` | calibrated vs real `/usage` (Pro account) |
| `max5` | `17,500,000` | `450,000,000` | extrapolated 5× from Pro |
| `max20` | `70,000,000` | `1,800,000,000` | extrapolated 20× from Pro |

> The `pro` row was empirically calibrated against the official `/usage` panel
> (two simultaneous readings on a Pro account). The Max rows scale the calibrated
> Pro baseline at the documented tier ratios and are **not yet verified** — if you
> run Max, pin your own caps via the env vars and a PR with your readings is welcome.

Pricing lives in [`lib/pricing.js`](lib/pricing.js) and is matched by model-family
substring, so new point releases inherit the right rates automatically. Plan caps
live in [`lib/subscription.js`](lib/subscription.js).

## Project layout

```
.claude-plugin/   plugin.json + marketplace.json
statusline/       statusline.js        — the live gauge
hooks/            context-guard.js     — Stop: /compact nudge
                  session-logger.js    — SessionEnd: durable usage log
commands/         token-report.md      — /token-report slash command
scripts/          report.js            — the report engine (also npx-able)
lib/              pricing.js, transcript.js, format.js
test/             smoke.js + probes
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

## License

[MIT](LICENSE) © 2026 SolSolis-Sys

<div align="center"><sub>Built with Claude Code · part of the NOWS toolset</sub></div>
