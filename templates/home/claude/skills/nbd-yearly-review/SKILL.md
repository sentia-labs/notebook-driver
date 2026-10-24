---
name: nbd-yearly-review
description: Guide the human through the yearly (chapter) review and annual migration - appreciate the year, reflect on where they are, write next year's intentions and goals, and set up the new year by hand - and record it in the vault. Use when the human runs `nbd ritual yearly` or asks for a yearly or annual review.
argument-hint: "[year e.g. 2026] [context file]"
disable-model-invocation: true
---

# Yearly review — the chapter ritual

Arguments: `$ARGUMENTS` — the year (`2026`) and the context file `nbd` prepared. Without them,
review the year that is ending.

The longest ritual: plan for one or two sittings; it can span days (save with `review: pending`,
resume with `nbd ritual yearly`). It follows Tiago Forte's ARC — **appreciate** the past,
**reflect** on the present, **create** the future — and the Bullet Journal's chapter ritual:
"Did these entries move me closer to or away from my intentions?", then an annual migration that
carries forward only what still matters. The human reflects and writes first, always.

## 0. Prepare (silently)

Read the context file, `vault/overview.md`, the year's quarterly and monthly notes, last year's
note, every project and area, and the collections. Create or update
`vault/journal/yearly/<year>.md` (`type: yearly`, `period`, `period_start`, `period_end`,
`review: pending`, `sources`; quote text values) with:

- **The year** — month by month, 1–3 cited highlights each.
- **Numbers** — pages written (first and last page of the year), actions done / migrated /
  struck, projects finished, the people who appeared most.
- **Threads** — what kept coming back.

## 1. Appreciate the past

Walk through **The year** a quarter at a time, briefly. Ask, one at a time: the best moments?
What are you grateful for — and to whom? What was hard, and what did it teach you? Did this
year's entries move you closer to or away from your intentions?

## 2. Reflect on the present

- Professional and personal, separately: where do you stand compared with a year ago?
- What matters most to you now? What has changed in what you value?
- For each project, area, habit and collection: **keep**, **refine**, or **release**?

## 3. Create the future

- Distill the year into one sentence. It often becomes next year's intention.
- Intentions, one to five: "Be [a quality] [in what context] so that [why it matters]".
- A few goals — few enough to matter, lighthouses rather than airports. For each, why it matters
  (ask "why?" until it's clear), and the first small step or one-to-two-week sprint.
- Optionally a word or theme for the year.

Offer to create project notes for goals that are already concrete.

## 4. Annual migration — by hand

The human sets up the new year on their pages:

- an **Intentions** page;
- a **Future Log** (`# Future Log` with `## 2027-01` …), seeded with what's already dated
  (context file, `vault/journal/future-log.md`);
- a **Goals** collection, and January's monthly log;
- for every open action and living collection: carry it over (rewrite it), schedule it, or let
  it go. Point to old pages (`→ p0123`) rather than copying long lists.

Offer candidates; let them choose and write. Pages hold 28 lines, so split across pages as
needed. Read what they wrote when they're done.

## 5. Close

Finish the yearly note: **Appreciate**, **Reflect** (keep / refine / release), **Next year**
(sentence, intentions, goals, first steps, theme — cited to their pages), **Migration** (what
carried over, what was let go), and the year's page range. Set `review: done`, `reviewed`,
`description`. Archive finished projects and retired areas with their OK. Rewrite `overview.md`
for the new year, intentions first. Append `## [YYYY-MM-DD HH:MM] review | yearly <year>` to
`vault/log.md`. Offer the quarterly and monthly reviews if those periods ended too.
