---
description: Show Claude Code token usage and cost (today, last 7 days, all time)
argument-hint: "[today|sessions|models]"
allowed-tools: Bash(node:*)
---

Token & cost report from token-watch:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/report.js" $ARGUMENTS`

Present the report above to the user. If it is empty, let them know no usage has been recorded yet.
