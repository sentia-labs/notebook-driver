---
name: nbd-monthly-review
description: Guide the human through the monthly ritual and Bullet Journal monthly migration (tidy, acknowledge patterns, migrate open actions, set up next month's log by hand, check projects and areas PARA-style) and record it in the vault. Use when the human runs `nbd ritual monthly` or asks for a monthly review.
argument-hint: "[month e.g. 2026-10] [context file]"
disable-model-invocation: true
---

# Monthly ritual & migration

Arguments: `$ARGUMENTS` — the month (`2026-10`) and the context file `nbd` prepared
(`.nbd/context/monthly-2026-10.md`). Without them, review the month that just ended.

The Bullet Journal's main ritual: rewriting by hand is the filter that keeps only what matters.
You prepare, ask and keep track; the human decides and writes, first (AGENTS.md §1). About
30–45 minutes; one question at a time; skip or pause whenever they want (`review: pending`).

## 0. Prepare (silently)

Read the context file, `vault/overview.md` (intentions, goals), the month's weekly notes, last
month's note (its plan), `vault/journal/future-log.md`, and the active project and area notes.
Create or update `vault/journal/monthly/<month>.md` (`type: monthly`, `period`, `period_start`,
`period_end`, `review: pending`, `sources`; quote text values) with:

- **At a glance** — 4–8 cited bullets across the weeks: what happened, what got done, what changed.
- **Timeline** — the month's events by date, one line per day that had something.
- **Actions** — counts (done, migrated, scheduled, struck, still open) and the open ones.

Keep any **Log** section the ingest already wrote.

## 1. Arrive

Show **At a glance** briefly. Ask how the month was, in a word or a sentence.

## 2. Tidy

Walk the month's pages with them: loose ends, unmarked done actions, events that never made it
onto a page. Offer to fill gaps in the timeline from what they remember.

## 3. Acknowledge

One at a time:
- Looking at the actions, moods and events: what added to your life this month, and what
  subtracted from it?
- Wins and lessons.
- For each goal or intention: does it still serve you?

Connect to last month's plan if there was one.

## 4. Migrate

Every open action from this month and earlier, oldest first, in batches of up to four with
AskUserQuestion. Before deciding, ask *why is it still open? does it matter? is it vital? what
would happen if it never got done?* Then: **migrate** (`[>]`, onto next month's log or into a
collection), **schedule** (`[<]`, Future Log), **done** (`[x]`), or **strike** (`[-]`). If an
action is an outcome they can't control ("win the deal"), help rewrite it as steps they can
("send the proposal Tue").

Also bring up next month's Future Log items — they move into next month's log. Give the exact edits
grouped by page. Don't change task states in the vault; the pages lead.

## 5. Enact — next month, by hand

Next month's Monthly Log is a page (or two) they write now:

```markdown
# 2026-11
- 03 Tu o dentist 9:00
- 14 Sa o Mom's birthday
## Actions
- [ ] * Q4 numbers to Jane
- [ ] renew passport
```

Pages hold 28 lines, so the timeline lists only days with something (or spans two pages). Offer
the candidates (Future Log items, migrated actions, dated events); let them choose and write.
Optionally pick up to three small habits to try for 30 days. Wait until it's written, then read it.

## 6. Projects, areas, someday

Building a Second Brain's monthly check, one item at a time:
- **Projects**: done ones → archive (with their OK); stalled ones → on hold, rescope or drop; is
  each outcome and deadline still right? In what order do they matter?
- **Areas**: any neglected? Is each standard still the one they want?
- **Someday**: the month's `!` inspirations, `?` explorations and `+` expand-later notes — keep,
  turn into a project or a page, or let go.
- **Collections**: any to start, merge or retire?

Make the vault changes they approve: archive by moving the file to `vault/archive/` with
`status: archived` (slugs are unique, so links keep working); update outcomes, deadlines and
**Where it stands**; create projects they commit to (cite the page where they wrote them).

## 7. Close

Finish the monthly note: **Reflection** (added / subtracted, wins, lessons), **Migration**
(decisions), **Projects & areas** (what changed), **Next month** (cited to the new monthly log).
Set `review: done`, `reviewed`, `description`. Refresh `overview.md`. Append
`## [YYYY-MM-DD HH:MM] review | monthly <month>` to `vault/log.md`. If the week also ended,
offer to fold the weekly ritual into this one.
