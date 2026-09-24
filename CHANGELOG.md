# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.7] - 2026-09-24

### Fixed
- **Silent hooks on Windows**: every hook command relied on the textual `${CLAUDE_PLUGIN_ROOT}` placeholder. `cmd.exe` does not expand `${VAR}`, and shells that did expand it dropped the backslashes of a Windows root (`C:\Users\you\.claude\…` became `C:Usersyou.claude…`). Both cases ended in `Cannot find module …`, exit code 1 and empty stdout — hooks registered but permanently mute (frozen `metrics.json`, no quota warning). All 6 commands now resolve their script inside Node from the `CLAUDE_PLUGIN_ROOT` environment variable and call the exported entry explicitly: `node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT,'hooks','<script>.js')).main()"` (`metrics-writer.js`, whose entry is async, as `.main().catch(() => process.exit(0))`).
- **The first Windows-safe dispatch was still mute**: replacing the placeholder with `require(…)` did resolve the module, but under `node -e` there is no entry module, so `require.main` is `undefined` and the `if (require.main === module) main();` guard every hook keeps stayed false — the command exited 0, printed nothing and wrote nothing, which is why a full cycle passed with dead hooks. The trailing `.main()` above is the fix; the dispatch test now fails when the module's entry is not called.
- Removed the `statusLine` block from `.claude-plugin/plugin.json`: it is not a recognized plugin component (`claude plugin details` lists hooks and skills, never a statusline). The statusline is registered in `~/.claude/settings.json`.
- Test invocation: `node --test test/` was treated by Node 22 as a file positional and failed. `npm test` now runs `node test/smoke.js && node --test "test/*.test.js"` (7 test files, probe scripts excluded).
- **A UTF-8 BOM in `config.json` silently discarded every threshold**: PowerShell 5.1 `Set-Content -Encoding utf8`, `Out-File` and Notepad all write a leading `U+FEFF`, `JSON.parse` rejected it, and the read fell back to `{}` — so a hand-edited `quota-alert-pct` or `compact-pct` was ignored and the component kept working at its default (90 / 80), exit 0, no warning. `lib/config.js` and `hooks/context-guard.js` now strip a single leading `U+FEFF` before parsing (the flat `config.yaml` parser already tolerated it); the CLI strips it too, so `get` reports `state: present and readable` and `set` rewrites the file as plain JSON, without a BOM of its own and without dropping the keys it found.
- **The CLI overwrote a `config.json` it had not managed to read**: `readConfig()` returned `{}` for a UTF-16LE file (PowerShell `Out-File -Encoding unicode` or `>`), a truncated file, commented JSON or an array root — indistinguishable from "nothing stored yet" — so `set` rewrote the file from an empty object and announced success, losing the settings it had not understood. The states are now told apart (absent → creatable; unreadable / invalid root → refuse). `set` and `get` exit 1, name the path and the suspected encoding or cause on stderr, and write nothing, so the file survives byte for byte. `reset` is deliberately unchanged: it deletes the file without reading it (`Deleted: <path>`), so it is still the way to get rid of a file the CLI refuses — with no warning about the contents it discards.

### Added
- **Configurable 5h quota alert** `quota_alert_pct` (default `90`), environment override `TOKEN_WATCH_QUOTA_ALERT_PCT`, precedence env > `config.yaml` > `config.json` > default. Emitted by `loop-advisor.js` on `UserPromptSubmit` and `Stop` from `usage-cache.json` only — no network call. The alert names the crossed threshold; below it the loop advisory is unchanged.
- `token-watch-config set quota-alert-pct <0-99>` (underscore spelling `quota_alert_pct` also accepted — one canonical dashed key on disk) as the third entry point for the new key.
- `lib/config.js` now reads `config.json` (written by that CLI) as a fallback below `config.yaml`, so a key set with `token-watch-config` is really applied by the loop advisor, the quota alert and the statusline — `config.yaml` still wins over it, and the environment wins over both.
- `test/hooks-config.test.js` (hook dispatch reproduced against a fake plugin root, with a negative control for the mangled path), `test/quota-alert.test.js` (threshold precedence, cooldown, corrupt-cache cases, no child process spawned) and the CLI/config parity checks of `test/config.test.js` — now including a UTF-8 BOM, a UTF-16LE file, a truncated file, commented JSON and an array root, where the CLI must refuse without writing and the readers must keep working from the defaults.

### Changed
- Advisory cooldown is now session-scoped (`{ sessionId, ts, pct }` in `loop-advisor-last.json`): a new session always gets its first advisory, a quota threshold crossing always goes through, and a sustained overrun is re-reported at most every 30 minutes (was: 60 s, session-agnostic).
- `quota_alert_pct` invalid (text, `NaN`, ≤ 0) falls back to the default; a missing, corrupt or non-numeric usage cache stays silent with exit 0 and no stray output.
- `README.md`: install/verify steps, statusline configuration under `settings.json` (Windows example) with the plugin-manifest limitation and the open Claude Code 2.1.281/Windows behaviour, threshold table with environment variables and precedence, which config file each component reads, the difference between the tolerant readers (hooks, statusline: an unreadable `config.json` is ignored, the next source applies) and the CLI (refuses it with exit 1), and a step-by-step *Troubleshooting a silent hook* section.
- Version realigned across `.claude-plugin/marketplace.json` (was `0.3.5`), `.claude-plugin/plugin.json` and `package.json` — all three now `0.3.7`.

## [0.3.6] - 2026-07-25

### Fixed
- **Sync lag**: metrics-writer now calls `getUsage()` at Stop event to refresh usage cache before reading it, ensuring statusline displays current quota data instead of one-cycle-old cached data — issue: "affichage en retard d'un tour de conversation"

## [0.3.5] - 2026-06-23

### Added
- **Statusline**: show context window size next to model name (e.g. `144k/200k`) — issue #7
- **Config system**: `token-watch-config set/get/reset` CLI — user-configurable thresholds via `~/.claude/token-watch/config.json`
- **Pre-compact warning**: configurable early warning threshold (`pre-compact-pct`) before the hard `/compact` nudge — issue #8
- **Cache TTL countdown**: display remaining TTL on subscription cache in statusline
- **Centralized config**: `config.yaml` as single source of truth for all thresholds
- **CI**: GitHub Actions workflow with badge on README
- **Loop advisor**: reads `loop_pct` from `loadConfig()` (closes config.yaml gap)

### Fixed
- `loop-advisor`: use `loadConfig()` for `loop_pct` threshold instead of hardcoded value
- Translated French calibration comment to English in `subscription.js`

### Changed
- README updated to document `pre-compact-pct` and all new config keys

## [0.3.2] - 2026-06-17

### Added
- `metrics-writer`: `cache_creation` precedence fix + atomic write with `EXDEV` cross-device cleanup
- Removed `PostToolUse` hook (replaced by `Stop` hook coverage)

### Fixed
- Removed heuristic fallback for subscription gauges — show explicit error if API unavailable (no silent wrong data)

### Changed
- Bump `0.3.1` → `0.3.2` (no-heuristic-fallback)

## [0.3.1] - 2026-06-17

### Added
- **Loop advisor** extended to `Stop` hook — covers autonomous agent mode with 60s cooldown (B1)
- **Session cost** in loop advisory output + extracted constants module — closes #3, #4
- Ecosystem section in README: cross-references `claude-conductor` and `conductor-blueprints`
- Commercial-style README rewrite with agent-installable prompt

### Fixed
- `loop-advisor` hook output format: `additionalContext` inside `hookSpecificOutput`
- Backoff cap + force-refresh every 6h for `/usage` cache

## [0.3.0] - 2026-06-16

### Added
- **Subscription gauges**: inline 5h and 7d rolling-window gauges from Anthropic OAuth endpoint
- **Real usage data**: replaced estimations with live `/api/oauth/usage` (read-only, cached 60s)
- **TLS**: secure-by-default; `TOKEN_WATCH_TLS_STRICT=0` for corporate proxies
- Auto-detection of plan (`pro` / `max5` / `max20`) with per-family context window
- Persistent disk cache for `/usage` with atomic writes + backoff

### Fixed
- Calibration of Pro session cap (4M tokens / weekly 218M) based on real measurements
- Backoff persistence + atomic disk cache write (issue #1)
- Copyright aligned to org; internal brand/session references removed

### Changed
- Subscription gauges section in README updated: removed "estimations" disclaimer now that live API is used
- Anthropic non-affiliation disclaimer added to README

## [0.2.0] - 2026-06-14

### Added
- Branding update; complete Anthropic pricing table (Opus 5/25, Sonnet 3/15, Haiku 0.8/4)
- Dynamic context window per model family
- Subscription usage tracking (initial implementation)

### Fixed
- Real Anthropic rate card corrections (Opus 5/25, Haiku 1/5)
- Statusline install docs: plugins cannot contribute `statusLine` directly; updated to manual + agent-driven steps

### Changed
- Repo and install URLs updated to `SolSolis-Sys` org

## [0.1.0] - 2026-06-13

### Added
- Initial release: live token count, context-window fill %, and session cost from local JSONL transcripts
- Statusline gauge with green → yellow → red color ramp
- `/token-report` command (today, sessions, models, all-time)
- Session logger hook (`SessionEnd`)
- Zero dependencies — pure Node.js built-ins

### Fixed
- Timestamp sorting and `cacheWrite` precedence hardened after initial release

[Unreleased]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.7...HEAD
[0.3.7]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.6...v0.3.7
[0.3.6]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.5...v0.3.6
[0.3.5]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.2...v0.3.5
[0.3.2]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SolSolis-Sys/claude-token-watch/releases/tag/v0.1.0
