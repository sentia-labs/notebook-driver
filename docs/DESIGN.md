# Design

notebook-driver splits note-taking into two channels with different owners:

- a **human-first entry channel** — the notebook: hand-written markdown pages, 28 lines each,
  Bullet Journal style. It is the source of truth and nothing but the human writes it;
- an **AI-maintained knowledge layer** — the vault: a second brain the agent compiles from the
  pages, browsed (not edited) by the human.

This document records what the design borrows from each method, how they map onto each other, and
the decisions that follow. Research was done in October 2026; sources are listed at the end.

## 1. The methods

### Bullet Journal (Ryder Carroll) — the human channel

The 2018 book (*The Bullet Journal Method*) and the method as Ryder Carroll has taught it since
late 2023 ("Bullet Journal 3.0") differ in places; notebook-driver follows the current teaching
where they diverge, while staying compatible with the classic key.

What we keep, because it is about the *human* doing the work:

- **Rapid logging**: short, clear entries ("write for a stranger"), each with a bullet that says
  what it is. 3.0's four bullets are **N.A.M.E.** — notes (–), actions (•, the task renamed
  "because the word action reminds me of my agency"), moods (=, affect labeling) and events (○,
  increasingly logged after they happen). Action states record what happened: done (×),
  migrated (>), scheduled into the future log (<), irrelevant (struck); `/` is half an × —
  started, or delegated. Signifiers in the margin: priority (\*, sparingly), inspiration (!),
  explore (👁, written `?` here), expand later (+). Keep custom symbols to a minimum.
- **Topics and page numbers**: every page says what it is about; collections continue across
  pages by threading page numbers. Don't pre-date daily logs.
- **The core collections**: index, future log, monthly log (a timeline plus an action plan), daily
  log; 3.0 adds an **Intentions** page ("Be [a quality] [in a context] so that [why]") and makes the
  weekly log routine.
- **Migration**: open actions are reviewed — *does this matter? is it vital? what would happen if
  it never got done?* — and rewritten by hand into the next period, scheduled into the future log,
  or struck. "If an entry isn't worth the few seconds of effort required to rewrite it, then it's
  probably not that important." The yearly version is the chapter ritual: a new notebook that
  carries over only what still matters.
- **Rituals** (3.0): daily, weekly, monthly and chapter (yearly), all following **T.A.M.E.** —
  *Tidy* the record, *Acknowledge* what moved you toward or away from your intentions, *Migrate*
  what supports them, *Enact* a prioritized plan. Ryder's weekly ritual: one spread, the week gone
  by on the left (up to three things toward your intentions, up to three away), the week to come on
  the right (only what you'll actually do, ranked, plus something to look forward to).
- **On AI** (2025–26): keep the handwritten journal as the source of truth, copy what's useful into
  a digital store (Ryder uses Obsidian, markdown files), and don't outsource "the thinking that
  makes me me — what I want, what I value, what I'm avoiding." His MIND framework uses AI as an
  editor and challenger *after* the human has drafted. And: "If you don't have a system to revisit
  your ideas, writing things down becomes a form of forgetting."

How it maps here:

| Bullet Journal | notebook-driver |
|---|---|
| A page in a notebook | `notebook/pNNNN.md`, 28 lines, numbered in order |
| Bullets, states, signifiers | `- [ ]`, `- o`, `- =`, `- `, `[x] [/] [>] [<] [-]`, `* ! ? +` (see `KEY.md`) — plain markdown, typeable, greppable; matches the conventions of existing markdown BuJo tools |
| Page topic / page number | first line `# …` / the file name; the viewer and nvim show "page 42" |
| Daily log | `## 2026-10-22 Thu` headings; days flow across pages |
| Monthly log, future log, weekly log | pages written by hand from the rituals' drafts; 31 days don't fit 28 lines, so the timeline lists only days with something (or spans two pages) |
| Index | **automated**: the viewer's notebook index (collections and logs → page numbers), `vault/index.md`, backlinks, "derived from this page" |
| Threading | `→ p57` / `[[p0057]]`, resolved by the viewer |
| Migration | the agent proposes a decision for every open action and drafts the rewrite; the human corrects it, marks `[>]` / `[<]` / `[-]` and writes it by hand |
| Rituals | weekly, monthly, quarterly, yearly reviews of five minutes or less: tidy and migrate only, no reflection; the agent records them in `vault/journal/` |
| Intentions, T.A.M.E. *Acknowledge*, weekly spread | **not kept** (see below) |

The one thing deliberately *not* automated is the writing. The 28-line limit and the final
rewrite in migration stay with the human. The agent removes the clerical parts of a Bullet
Journal (indexing, threading, looking things up, remembering what's still open, preparing the
migration) and leaves deciding and writing to the human, with the vault as the "system to revisit
your ideas".

**What is not kept: the Bullet Journal as a thinking method.** Bullet Journal 3.0 presents itself
as a way to think: intentions, affect labeling, rituals that ask what moved you toward or away
from who you want to be. This notebook has one user, who thinks without it and uses it to track
facts and find them quickly later. Reflection in the rituals made them feel like a chore, so it
is gone: no Intentions page, no toward/away, no wins and lessons, no goals or life inventory. The
rituals keep the record current and migrate open actions, and nothing else.

### Building a Second Brain (Tiago Forte) — the organizing principles

- **CODE**: Capture, Organize, Distill, Express. Here the human captures (pages); the agent
  organizes and distills; expression is the human's (with `nbd ask` and syntheses to help).
- **PARA**: projects (an outcome with a deadline), areas (a standard to maintain, no end date),
  resources (topics of interest), archive (inactive). Organize by *actionability*. Placement test:
  which project is this useful for? Else which area? Else which resource? Else don't keep it.
- **Progressive summarization**: bold the key passages, highlight the best of those, summarize on
  top — done opportunistically. Vault notes carry a standalone summary, **bold** and `==highlight==`.
- **Reviews**: weekly (clear inboxes, check calendar, choose the week's tasks, sort new notes) and
  monthly (goals, projects, areas, someday/maybe, reprioritize). Forte's annual review uses ARC:
  appreciate the past, reflect on the present, create the future.
- **Hemingway bridge**: end a session knowing the next step. Project notes have a "Where it
  stands" section that does this for the human and for the next agent run.
- In 2026 Forte repositioned the method as "AI-first": PARA folders of local files as
  "pre-assembled bundles of context" for agents. He publishes no file format, though.

### The LLM wiki (Andrej Karpathy, April 2026) — the AI-compatible format

The most widely referenced pattern for agent-maintained knowledge bases, and the most plausible
meaning of "AI-compatible second brain format":

- **Raw sources** are immutable — "the LLM reads from them but never modifies them. This is your
  source of truth." → our notebook.
- **The wiki** is owned by the LLM — summaries, entity pages, concept pages, syntheses — "you
  read it; the LLM writes it." → our vault.
- **The schema** (CLAUDE.md / AGENTS.md) tells the agent how the wiki is structured and which
  workflows to follow; human and agent evolve it together. → `AGENTS.md`.
- Operations: **ingest** (read a source, update 10–15 pages, the index and the log), **query**
  (answer with citations; good answers can be filed back), **lint** (contradictions, stale claims,
  orphans, missing pages and links).
- `index.md` — a catalog read first; `log.md` — append-only, `## [date] op | title` entries.

The gist leaves file conventions open. Implementations converge on flat YAML frontmatter (`type`,
`title`, `sources`, `tags`, `created`, `updated`), `[[wikilinks]]`, and the index/log files. Google
Cloud's Open Knowledge Format (OKF, v0.2) adds keyed provenance: `sources` plus footnotes.

## 2. Decisions

**Vault = LLM wiki, organized with PARA, logged like a Bullet Journal.**
`projects/ areas/ resources/ archive/` for knowledge, `journal/{daily,weekly,monthly,quarterly,yearly}`
for chronology, `inbox/` for questions, `index.md` · `log.md` · `overview.md` at the root.

**Wikilinks by unique slug.** `[[jane-doe]]` resolves wherever the note lives, so moving a project
to `archive/` breaks nothing and the agent never computes `../../` paths (the most common
link-writing error for LLMs). Obsidian reads the vault as is. Notebook pages are `[[p0042]]`.

**Citations quote the page.** Each claim gets a footnote with the page link and a short verbatim
quote. Quotes survive edits that shift line numbers (a text-quote anchor), read naturally, and are
machine-checkable: `nbd lint` greps each quote on its page, catching misquotes and claims whose
support was edited away. Note-level provenance lives in frontmatter `sources`, which the viewer
turns into "derived from this page" links.

**The index is generated, not written.** `vault/index.md` is rebuilt by code from each note's
`title` and `description`, so it can't drift from the files; the agent keeps those fields accurate.

**Pages are mutable, so ingest is incremental.** Unlike a Karpathy-style raw folder, the human
edits pages (ticks a task, adds a line). The daemon keeps a snapshot of what the agent last saw
for each page; the next ingest gets a diff plus the full numbered page. Snapshots are taken from
what was *sent*, so edits made during a run stay pending.

**When to run the agent.** Humans save often; ingesting on every save is wasteful and churns the
vault. A page is ingested when it has been left alone for 5 minutes, or 30 seconds after it fills
up or a newer page is started (the human has moved on), or on demand (`nbd sync`). Pages that
settle together are batched into one run. Failed runs back off exponentially.

**Questions are files.** A headless run can't ask anyone, so the agent writes
`vault/inbox/qNNNN.md` (with suggested answers) and carries on with what it knows. The human
answers wherever is handy — viewer, nvim float, CLI, a guided session, or `q7: …` on a page — and
the next run applies the answer everywhere and marks the question resolved.

**Rituals are five-minute conversations; the facts come from code.** `nbd ritual weekly` first
computes the facts deterministically from the pages — open tasks oldest first, what was done,
events, what is dated ahead, project status — so the agent doesn't miss a task and needn't read
much. Then a skill runs a fixed protocol (AGENTS.md §5): the agent proposes a decision for every
open action in one numbered list; the human corrects it in one reply; the agent drafts the
migration (the new page, the marks on old pages, the Future Log additions) for the human to edit
and write by hand. The agent never writes the page. A review is done when its journal note says `review: done`; that is also how
the daemon knows to stop reminding.

**Rituals are timed.** `nbd` records every run in `.nbd/ritual-runs/` — start, end, active
minutes (pauses over 15 minutes left out), the agent's time and the human's, replies, cost, and
whether the review finished. The Rituals page and `nbd rituals --runs` list them with the median
per ritual against the five-minute target, so the rituals themselves can be reviewed and changed.
The agent never writes these records.

**Cadences.** Weekly: migrate the week's open actions into a weekly log. Monthly: the same at
month level, the next monthly log, and stale projects (keep, on hold, archive). Quarterly: every
project's status and the Future Log for the next six months; no task migration, which the
monthly review of the same month does. Yearly: the annual migration — open actions, collections
and projects carried into the new year or let go, a new Future Log and January's log. Reviews become available at the end of each period and are tracked by the
journal note, so a skipped review is visible, not nagging forever: only the latest period is due.

**Harness-agnostic, Claude Code first.** The contract is `AGENTS.md` (Claude Code imports it from
`CLAUDE.md`). Skills live in `.claude/skills/` and are plain markdown other harnesses can be
pointed at. Codex runs inside `vault/` with its workspace-write sandbox; any other CLI can be
plugged in with an argv template.

**Viewer: server-rendered, local, offline.** markdown-it with Shiki (VS Code-grade highlighting,
dual light/dark themes), Mermaid and KaTeX served from `node_modules` (no CDN), MiniSearch for
full-text search, server-sent events for live reload. Bound to 127.0.0.1, with a Host check
against DNS rebinding and a custom header against cross-site POSTs (the only writes are answers).

## 3. Sources

- Bullet Journal: Ryder Carroll, *The Bullet Journal Method* (2018) · rapid logging: https://bulletjournal.com/blogs/faq/what-is-rapid-logging-understand-rapid-logging-bullets-and-signifiers · migration: https://bulletjournal.com/blogs/faq/migration · monthly log: https://bulletjournal.com/blogs/faq/monthly-log · future log: https://bulletjournal.com/blogs/faq/how-to-make-a-future-log · threading: https://bulletjournal.com/blogs/bulletjournalist/threading · yearly migration: https://bulletjournal.com/blogs/bulletjournalist/yearly-migration
- Bullet Journal 3.0: N.A.M.E. bullets https://bulletjournal.com/blogs/bulletjournalist/how-to-improve-focus-using-a-bullet-journal · rituals https://bulletjournal.com/pages/a-ritual-checklist-to-help-you-bujo-consistently · mid-year ritual https://bulletjournal.com/blogs/bulletjournalist/taking-time-for-a-mid-year-ritual · 12-month roadmap https://bulletjournal.com/pages/my-12-month-roadmap
- Markdown BuJo conventions: https://minimal.guide/checklists · https://bujo.mihaiconstantin.com/guide/syntax-highlighting · https://github.com/frankolson/obsidian-bujo-bullets
- Tiago Forte, Building a Second Brain overview: https://fortelabs.com/blog/basboverview/
- The PARA Method: https://fortelabs.com/blog/para/
- Progressive Summarization: https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes/
- The Weekly Review: https://fortelabs.com/blog/the-weekly-review-is-an-operating-system/ · The Monthly Review: https://fortelabs.com/blog/the-monthly-review/
- Why PARA is the key to the AI era (2026): https://fortelabs.com/blog/why-para-is-the-key-to-the-ai-era/
- Introducing the AI Second Brain (2026): https://fortelabs.com/blog/introducing-the-ai-second-brain/
- Andrej Karpathy, LLM Wiki: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Open Knowledge Format: https://github.com/GoogleCloudPlatform/open-knowledge-format
- Basic Memory knowledge format: https://docs.basicmemory.com/concepts/knowledge-format
- Obsidian properties and links: https://obsidian.md/help/properties · https://obsidian.md/help/links
- AGENTS.md: https://agents.md/ · Claude Code memory: https://code.claude.com/docs/en/memory
- W3C Web Annotation, text quote selectors: https://www.w3.org/TR/annotation-model/#text-quote-selector
