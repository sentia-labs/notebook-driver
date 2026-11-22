---
name: nbd-yearly-review
description: Run the yearly review and annual migration - propose what carries into the new year (open actions, collections, projects), let the human correct it in one reply, draft the new year's first pages for them to write by hand - and record it in the vault. Use when the human runs `nbd ritual yearly` or asks for a yearly or annual review.
argument-hint: "[year e.g. 2026] [context file]"
disable-model-invocation: true
---

# Yearly review — the annual migration

Arguments: `$ARGUMENTS` — the year (`2026`) and the context file `nbd` prepared. Without them,
review the year that is ending.

Follow the ritual protocol in AGENTS.md §5: five minutes, no reflection, propose → correct →
draft → close. You never write on the pages. The year has more decisions than a month, so keep
each line short.

## 0. Prepare (silently)

Read the context file, `vault/journal/future-log.md` and `vault/index.md` (for the collections).
Create or update `vault/journal/yearly/<year>.md` (`type: yearly`, `period`, `period_start`,
`period_end`, `review: pending`, `sources`; quote text values) with:

- **The year** — month by month, 1–2 cited highlights each.
- **Numbers** — the year's page range, actions done / migrated / struck, projects finished.

## 1. Propose — your first message

- **Open actions**, numbered, oldest first, with your proposal and reason (AGENTS.md §5).
- **Collections** (`# Books to read` and the like): **carry** (point to it from the new year),
  or **close**.
- **Projects**: **keep**, **on hold** or **archive**.
- **Inbox**: each open question in one line, with the answer you suggest.

End with: "Reply with the numbers to change, or `ok`."

## 2. Draft — your second message

1. A **Future Log** for the new year (`# Future Log`, `## 2027-01` …), seeded with what is
   already dated.
2. January's monthly log, with the migrated actions.
3. One line per carried collection for January's log, pointing back (`- Books to read → p0005`)
   rather than copying the list.
4. The marks on old pages, grouped by page, with line numbers.

28 lines per page; split as needed. Make the project changes they accepted. Record the inbox
answers they accepted. End with: "Edit it as you like, write it, then reply `written`."

## 3. Close

Read what they wrote. Finish the yearly note: **Migration** (what carried over, what was let go,
cited to the new pages) and **Projects**. Set `review: done`, `reviewed`, `description`. Update
`overview.md` for the new year. Append the log entry. One closing line. Offer the monthly review
if December's is still due.
