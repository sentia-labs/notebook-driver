---
name: nbd-questions
description: Go through the notebook agent's open clarification questions with the human, record their answers, and apply them to the vault right away. Use when the human runs `nbd questions --agent` or asks to answer the inbox questions.
disable-model-invocation: true
---

# Answer the inbox

1. List the open questions: `vault/inbox/q*.md` with `status: open`, oldest first. If there are
   none, say so in one line and stop.
2. For each, show the title and one or two lines of context, then ask with AskUserQuestion — its
   `options` plus "Skip for now" and "Dismiss (doesn't matter)"; the human can always type a
   free answer.
3. Record each answer in the question file: the text under `## Answer`; frontmatter
   `status: answered`, `answered: <now, ISO 8601 with offset>`, `answered_via: chat`. "Dismiss"
   sets `status: dismissed`; "Skip" changes nothing.
4. Apply the answers now, exactly as the ingest would (AGENTS.md §5 step 7): update every note the
   answer affects, then set `status: resolved`, `resolved: <date>` and add a `## Resolution`
   section listing what you changed.
5. Append `## [YYYY-MM-DD HH:MM] answers | q0007, q0008` to `vault/log.md` and finish with one
   line on what changed.
