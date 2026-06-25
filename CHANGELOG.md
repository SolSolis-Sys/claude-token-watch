# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.5...HEAD
[0.3.5]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.2...v0.3.5
[0.3.2]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SolSolis-Sys/claude-token-watch/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SolSolis-Sys/claude-token-watch/releases/tag/v0.1.0
