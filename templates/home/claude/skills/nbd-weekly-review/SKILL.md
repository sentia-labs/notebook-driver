---
name: nbd-weekly-review
description: Run the five-minute weekly review - propose a decision for every open action, let the human correct it in one reply, draft the migration for them to write by hand - and record it in the vault. Use when the human runs `nbd ritual weekly` or asks for a weekly review.
argument-hint: "[week e.g. 2026-W43] [context file]"
disable-model-invocation: true
---

# Weekly review

Arguments: `$ARGUMENTS` — the ISO week (`2026-W43`) and the context file `nbd` prepared
(`.nbd/context/weekly-2026-W43.md`). Without them, review the week that just ended and gather the
facts from the pages yourself.

Follow the ritual protocol in AGENTS.md §5: five minutes, no reflection, propose → correct →
draft → close. You never write on the pages.

## 0. Prepare (silently)

Read the context file and last week's note (`vault/journal/weekly/<previous>.md`). Create or
update `vault/journal/weekly/<week>.md`, keeping any **Log** the ingest wrote:

```markdown
---
type: weekly
title: "Week 43 · Oct 19 – 25, 2026"
description: "(one line, written at the end)"
period: 2026-W43
period_start: 2026-10-19
period_end: 2026-10-25
review: pending
sources:
  - "[[p0040]]"
---
# Week 43 · Oct 19 – 25, 2026

## At a glance
3–5 cited bullets: what got done, what happened.
```

## 1. Propose — your first message

- **At a glance**, three lines at most.
- **Open actions**, numbered: this week's first, then older ones, oldest first. One line each:
  `3. strike — reorganize the garage (p0003:15) · open 5 weeks, untouched`.
- **Inbox**: each open question in one line, with the answer you suggest (`q2 → Jordan Lee`).

End with: "Reply with the numbers to change (`3 migrate, q2 skip`), or `ok`."

## 2. Draft — your second message

Apply their changes, then give, each in its own code block:

1. The weekly log for a fresh page (`:NotebookNew 2026-W44`): the migrated actions, priority
   first, and the events already dated next week. 28 lines at most.
   ```markdown
   # 2026-W44
   - [ ] * Q4 numbers to Jane
   - [ ] renew passport
   - o Thu dinner with Leah
   ```
2. The marks on old pages, grouped by page, with line numbers.
3. Future Log additions under their months, if any.

Record the inbox answers they accepted, as `/nbd-questions` does. End with: "Edit it as you like,
write it, then reply `written`."

## 3. Close

Read the new page and the marked lines. Finish the weekly note: **Decisions** (each action and
what happened to it) and **This week** (cited to the new page). Set `review: done`, `reviewed`,
`description`, and add the new page to `sources`. Append the log entry. One closing line.
