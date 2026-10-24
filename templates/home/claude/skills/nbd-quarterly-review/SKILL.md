---
name: nbd-quarterly-review
description: Guide the human through a quarterly review (themes of the quarter, goals and intentions check, life inventory, one to three focus outcomes and sprints for the next quarter) and record it in the vault. Use when the human runs `nbd ritual quarterly` or asks for a quarterly review.
argument-hint: "[quarter e.g. 2026-Q4] [context file]"
disable-model-invocation: true
---

# Quarterly review

Arguments: `$ARGUMENTS` — the quarter (`2026-Q4`) and the context file `nbd` prepared. Without
them, review the quarter that is ending.

Neither the Bullet Journal nor Building a Second Brain prescribes a quarterly ritual. This one is
modelled on Ryder Carroll's mid-year ritual (an augmented monthly: check goals, reset intentions,
reset priorities, celebrate wins and lessons) and Tiago Forte's past–present–future review, at a
three-month horizon. About 45 minutes; one question at a time; the human answers first.

## 0. Prepare (silently)

Read the context file, `vault/overview.md`, the quarter's monthly notes and the weekly
toward/away lists, last quarter's note, and every project and area note. Create or update
`vault/journal/quarterly/<quarter>.md` (`type: quarterly`, `period`, `period_start`, `period_end`,
`review: pending`, `sources`; quote text values) with:

- **The quarter** — month by month, 2–3 cited highlights each.
- **Numbers** — pages written; actions done, migrated, struck; projects started and finished.
- **Threads** — themes, people and topics that kept coming back, and the recurring toward/away items.

If the month also ended, suggest running the monthly ritual first.

## 1. Look back

Show **The quarter** briefly. Ask, one at a time: which wins deserve celebrating? What lessons?
What surprised you? Then share the threads you noticed and ask which ring true.

## 2. Goals and intentions

For each goal (from `overview.md` and the pages): does it still matter? Given what you've learned,
what should change? Then the intentions: still the right ones for the season ahead? How do you
want to be — act, think, feel — over the next three months?

## 3. Life inventory

Briefly, area by area — their PARA areas, or work, friends & family, physical health, mental
health, daily upkeep, self-development: how is it, honestly, in a sentence? Which one deserves
the focus of the next three months?

## 4. Enact

- One to three outcomes that would make next quarter a success, each with a rough deadline; offer
  to create or update the project notes.
- For each, the first sprint: one or two weeks, clear actions, the time estimate tripled.
- What will you stop, decline or postpone to make room?
- Ideas worth a small experiment: "I will [action] for [duration]".
- Extend the Future Log so it covers the next six months.

## 5. By hand

Suggest a short page (≤ 10 lines):

```markdown
# 2027-Q1 focus
- [ ] * ship newsletter issue 1 by Feb 15
- [ ] run 3x/week, knee pain-free
- = want to feel: steady, not rushed
- stop: weekend email
```

Wait until it's written; read it.

## 6. Close

Finish the quarterly note: **Wins and lessons**, **Goals and intentions**, **Life inventory**,
**Focus next quarter** (cited to their page), **Stop**. Set `review: done`, `reviewed`,
`description`. Create or update the projects they committed to, archive what they agreed to end,
and rewrite the focus and intentions sections of `overview.md`. Append
`## [YYYY-MM-DD HH:MM] review | quarterly <quarter>` to `vault/log.md`.
