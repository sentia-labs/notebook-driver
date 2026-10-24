@AGENTS.md

## Claude Code specifics

- `.claude/settings.json` denies every write under `notebook/`, and a hook backs it up. Don't look
  for a way around them — tell the human what to write on their page instead.
- Rituals and helpers are skills: `/nbd-weekly-review`, `/nbd-monthly-review`,
  `/nbd-quarterly-review`, `/nbd-yearly-review`, `/nbd-questions`, `/nbd-lint`.
- In interactive sessions, use AskUserQuestion for discrete choices (migrate / schedule / strike a
  task, picking an answer to an inbox question). Keep reflection as open conversation.
