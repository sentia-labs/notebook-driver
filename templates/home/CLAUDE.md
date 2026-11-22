@AGENTS.md

## Claude Code specifics

- `.claude/settings.json` denies every write under `notebook/`, and a hook backs it up. Don't look
  for a way around them — tell the human what to write on their page instead.
- Rituals and helpers are skills: `/nbd-weekly-review`, `/nbd-monthly-review`,
  `/nbd-quarterly-review`, `/nbd-yearly-review`, `/nbd-questions`, `/nbd-lint`.
- In rituals, put every decision in one numbered list and let the human reply in one message
  (AGENTS.md §5); don't ask one question at a time. Elsewhere, AskUserQuestion is fine for a
  discrete choice, such as picking an answer to an inbox question.
