---
name: nbd-monthly-review
description: Run the five-minute monthly review - propose a decision for every open action and stale project, let the human correct it in one reply, draft next month's log for them to write by hand - and record it in the vault. Use when the human runs `nbd ritual monthly` or asks for a monthly review.
argument-hint: "[month e.g. 2026-10] [context file]"
disable-model-invocation: true
---

# Monthly review

Arguments: `$ARGUMENTS` — the month (`2026-10`) and the context file `nbd` prepared
(`.nbd/context/monthly-2026-10.md`). Without them, review the month that just ended.

Follow the ritual protocol in AGENTS.md §5: five minutes, no reflection, propose → correct →
draft → close. You never write on the pages. If the week also ended, fold the weekly review in:
one proposal, one draft, both notes closed.

## 0. Prepare (silently)

Read the context file and `vault/journal/future-log.md`. Create or update
`vault/journal/monthly/<month>.md` (`type: monthly`, `period`, `period_start`, `period_end`,
`review: pending`, `sources`; quote text values), keeping any **Log** the ingest wrote:

- **At a glance** — 3–6 cited bullets: what got done, what happened, what changed.
- **Timeline** — the month's events by date, one line per day that had something.

## 1. Propose — your first message

- **At a glance**, three lines at most.
- **Open actions**, numbered, this month's first, then older ones, oldest first, with your
  proposal and reason (AGENTS.md §5).
- **Projects** from the context file that are done, past their deadline, or not updated in four
  weeks: propose **keep**, **on hold** or **archive**, with the reason.
- **Inbox**: each open question in one line, with the answer you suggest.

End with: "Reply with the numbers to change, or `ok`."

## 2. Draft — your second message

1. Next month's log for a fresh page (`:NotebookNew 2026-11`): a timeline of only the days with
   something (Future Log items for the month, events already dated), then the migrated actions.
   28 lines at most; if it doesn't fit, split it across two pages.
   ```markdown
   # 2026-11
   - 03 Tu o dentist 9:00
   - 14 Sa o Mom's birthday
   ## Actions
   - [ ] * Q4 numbers to Jane
   - [ ] renew passport
   ```
2. The marks on old pages, grouped by page, with line numbers.
3. Future Log additions under their months, if any.

Make the project changes they accepted: archive by moving the file to `vault/archive/` with
`status: archived` (slugs are unique, so links keep working), or set `status: on-hold`. Record the
inbox answers they accepted. End with: "Edit it as you like, write it, then reply `written`."

## 3. Close

Read what they wrote. Finish the monthly note: **Decisions** (actions and projects) and **Next
month** (cited to the new monthly log). Set `review: done`, `reviewed`, `description`. Update
`overview.md` if a project changed status. Append the log entry. One closing line.
