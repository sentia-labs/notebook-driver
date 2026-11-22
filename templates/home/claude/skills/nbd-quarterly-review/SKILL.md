---
name: nbd-quarterly-review
description: Run the five-minute quarterly review - propose a status for every project, let the human correct it in one reply, draft the Future Log for the next six months for them to write by hand - and record it in the vault. Use when the human runs `nbd ritual quarterly` or asks for a quarterly review.
argument-hint: "[quarter e.g. 2026-Q4] [context file]"
disable-model-invocation: true
---

# Quarterly review

Arguments: `$ARGUMENTS` — the quarter (`2026-Q4`) and the context file `nbd` prepared. Without
them, review the quarter that is ending.

Follow the ritual protocol in AGENTS.md §5: five minutes, no reflection, propose → correct →
draft → close. You never write on the pages. Open actions are not migrated here: the monthly
review at the end of the same month does that. If it is still due, suggest running it first.

## 0. Prepare (silently)

Read the context file and `vault/journal/future-log.md`. Create or update
`vault/journal/quarterly/<quarter>.md` (`type: quarterly`, `period`, `period_start`,
`period_end`, `review: pending`, `sources`; quote text values) with:

- **The quarter** — month by month, 1–3 cited highlights each.
- **Numbers** — pages written; actions done, migrated, struck; projects started and finished.

## 1. Propose — your first message

- **The quarter**, three lines at most.
- **Projects**, numbered, every one in the context file: propose **keep**, **on hold** or
  **archive**, with a reason (done, deadline passed, not updated since …), and a deadline fix
  where the pages show a new date.
- **Future Log**: what is dated in the next six months and not yet on a Future Log page.
- **Inbox**: each open question in one line, with the answer you suggest.

End with: "Reply with the numbers to change, or `ok`."

## 2. Draft — your second message

1. The Future Log additions for the next six months, grouped by month, ready for the current
   Future Log page or a fresh one (`:NotebookNew Future Log`). 28 lines at most per page.
2. The marks on old pages, if any (`[<]` for items now on the Future Log).

Make the project changes they accepted (archive: move to `vault/archive/`, `status: archived`).
Record the inbox answers they accepted. End with: "Edit it as you like, write it, then reply
`written`."

## 3. Close

Read what they wrote. Finish the quarterly note: **Projects** (decisions) and **Future Log**
(cited to the page). Set `review: done`, `reviewed`, `description`. Update `overview.md` if a
project changed status. Append the log entry. One closing line.
