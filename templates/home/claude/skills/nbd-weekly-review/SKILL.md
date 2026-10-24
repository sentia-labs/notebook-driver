---
name: nbd-weekly-review
description: Guide the human through their weekly ritual (Bullet Journal T.A.M.E. - tidy, acknowledge, migrate, enact - plus the Building a Second Brain weekly reset) and record it in the vault. Use when the human runs `nbd ritual weekly` or asks for a weekly review.
argument-hint: "[week e.g. 2026-W43] [context file]"
disable-model-invocation: true
---

# Weekly ritual

Arguments: `$ARGUMENTS` — the ISO week (`2026-W43`) and the context file `nbd` prepared
(`.nbd/context/weekly-2026-W43.md`). Without them, review the week that just ended and gather the
facts from the pages yourself.

A ritual, not a report: about 20–30 minutes, one question at a time, short turns, the human's
words over yours. They reflect and write first; you may offer a perspective or a gentle challenge
afterwards. You never write on their pages (AGENTS.md §1). Skip any step they want to skip; if
they stop early, save what you have with `review: pending`.

## 0. Prepare (silently, before you greet them)

Read the context file, `vault/overview.md` (especially **Intentions**), last week's note
(`vault/journal/weekly/<previous>.md` — its plan), this week's daily notes and the projects touched.
Create or update `vault/journal/weekly/<week>.md`:

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
3–6 cited bullets: what happened, what got done, how it felt (moods), what moved.

## Open loops
Open actions from this week, then older ones still open, oldest first.
```

Keep any **Log** section the ingest already wrote.

## 1. Arrive

Show **At a glance** in a few lines. Ask how the week was, in a word or a sentence.

## 2. Tidy

Make the record current. Ask: is anything done that isn't marked `[x]`? Anything that happened
and isn't on a page yet (an event to log after the fact, a missed day to rapid-summarize)? Any
action that belongs to a later month (`[<]` → Future Log)? Collect the edits for step 6.

## 3. Acknowledge

Against their intentions (read them back if they exist):
- Up to three things that moved you **toward** them this week.
- Up to three that moved you **away**.
- What did you learn?

How did last week's plan go? Mention at most one pattern you see across recent weeks.

## 4. Migrate

The filter: *does this matter? is it vital? what would happen if it never got done?* Go through
the open actions — this week's first, then the oldest — in batches of up to four with
AskUserQuestion. For each:

- **migrate** — still serves their intentions: mark it `[>]`, rewrite it in this week's plan;
- **schedule** — belongs to a later month: mark it `[<]`, add it to the Future Log;
- **done** — mark it `[x]`;
- **strike** — no longer matters: mark it `[-]`.

Give the exact edits grouped by page, so they can make them in nvim now or after:

```
p0041 line 5   - [ ] email Ana   →   - [>] email Ana
```

Don't change task states in the vault; the next ingest reads them from the pages. Record the
decisions in the review note.

## 5. Enact

- **Plan**: only what will realistically get done this week; rank it, one top priority.
- Something to look forward to: one to three things outside work, with a time.
- Each active project touched this week or idle for 2+ weeks: is the next step clear? Update the
  project's **Where it stands** with what they tell you.
- Open inbox questions: offer to settle them now (AskUserQuestion), recording answers as
  `/nbd-questions` does.

## 6. By hand

Suggest a weekly spread for a fresh page (`:NotebookNew 2026-W43 review`), for example:

```markdown
# 2026-W43 review
## Toward
- shipped the export fix without overtime
## Away
- scrolled past 23:00 three nights
## This week
- [ ] (1) * Q4 numbers to Jane
- [ ] renew passport
- o Thu dinner with Leah
```

Plus the migration edits from steps 2 and 4. Wait until they say it's written, then read it.

## 7. Close

Finish the weekly note: **Toward / Away** and **Learned** (their words, cited to the spread),
**Decisions** (migrated, scheduled, struck), **This week** (the plan, cited). Set `review: done`,
`reviewed: <today>`, the `description`, and add the spread's page to `sources`. Update project
notes and `overview.md` if the big picture moved. Append to `vault/log.md`:
`## [YYYY-MM-DD HH:MM] review | weekly <week>`. Close in a sentence or two — no recap dump.
