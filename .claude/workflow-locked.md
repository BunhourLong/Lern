<!--
USER-SET WORKFLOW. DO NOT REWORD, REORDER, SHORTEN OR "IMPROVE" THIS FILE.
Only the user may change it, and only by saying so in the current session.
Agents: copy rows into other files verbatim; never paraphrase the model names or options.
-->

# Locked workflow (set by the user)

## Main orchestrator (decided 2026-11-19)
- `antigravity` / `gemini-4-neon`, `thinking_level: low` on low tasks, `medium` on medium and high-risk tasks. Never `high`/`xhigh`. Never any other Gemini model (Argon, Hydrogen, Flash, ...).
- Reason: keep Claude Pro / Opus 5.5 free for other projects.
- Antigravity skips `.claude/settings.json` hooks and `.claude/rules/`, so the main session explicitly runs `graphify query`, follows `ponytail` (`ultra`) and reads the matching `.claude/rules/gotchas-*.md`.

## Standing routing
| Job | Provider and model | Options |
| --- | --- | --- |
| Implementation, tests, fixes of high-risk tasks | `claudeAgent_2` / `claude-opus-5-5` | `effort: high` |
| Review of high-risk tasks | `codex` / `gpt-6.2-sol` | `reasoningEffort: high` |
| Implementation, tests, fixes of medium tasks | `codex` / `gpt-6.2-sol` | `reasoningEffort: high` |
| Implementation, tests, fixes of low tasks | `opencode` / `opencode-go/deepseek-v4.1-flash` | `variant: max` |
| Review of medium and low tasks | `opencode` / `opencode-go/glm-5.3-flash` | `variant: max` |
| Read-only codebase search and basic research | `opencode` / `opencode-go/deepseek-v4.1-flash` (or `opencode-go/glm-5.3-flash`) | `variant: max` |

## TEMPORARY OVERRIDE: OpenCode Go exhausted (user, 2026-11-19)
The user's OpenCode Go monthly allowance is nearly spent (about 5% left, about 13 days to the reset, so until about 2026-12-02; the user will say when it has reset). While it lasts, these three rows replace the three OpenCode Go rows above. All other rows are unchanged.

| Job | Provider and model | Options |
| --- | --- | --- |
| Implementation, tests, fixes of low tasks | `claudeAgent_2` / `claude-haiku-5-5` | `effort: high` if the model accepts it |
| Review of medium and low tasks | `claudeAgent_2` / `claude-sonnet-5-5` | `effort: high` |
| Read-only codebase search and basic research | `claudeAgent_2` / `claude-haiku-5-5` | `effort: high` if the model accepts it |

- Writer and reviewer stay different models (Haiku writes, Sonnet reviews).
- Haiku 5.5 and Sonnet 5.5 are allowed only under this override. When the user says OpenCode Go has reset, delete this section and the Standing routing applies again.
- No other substitutes. Never any Gemini model besides Gemini 4 Neon, never GPT-6 Luna, GPT-6 Astra, GPT-6.2 Astra, GPT-6.1-*, OpenCode free models, Claude native `Agent` tool or launcher scripts.
- A Claude Pro limit pauses the task per the Limit rule in `.claude/run-task.md`; nothing takes over and no model or plan is switched.
