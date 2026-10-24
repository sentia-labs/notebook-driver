# Key

Rapid logging, Bullet Journal style, written as plain markdown: short lines, one thought per
bullet, nothing you can't type on any keyboard. Your pages are yours — the agent reads them and
never writes them.

## Bullets

| Write | Shows as | Means |
|---|---|---|
| `- [ ] call Mom` | • | **action** (task) — something to do |
| `- o dentist 3pm` | ○ | **event** — something that happens: plan it, or log it after |
| `- = anxious before the demo` | = | **mood** — how you felt, emotionally or physically |
| `- rent goes up 5% in Jan` | – | **note** — facts, ideas, thoughts, observations |

Indent to add detail under an entry:

```markdown
- o lunch with Jane
  - she's moving to Denver in March
```

Short, but clear to a stranger: "call Catherine re: cake for Mark's party Sat", not "call CC re cake".

## Action states

Change the box as an action moves; never erase it — the history is the point.

| Write | Shows as | Means |
|---|---|---|
| `- [x]` | × | done |
| `- [/]` | / | half an ×: started, or handed off (`- [/] pull Q3 numbers — @Kevin`) |
| `- [>]` | > | **migrated** — still matters, rewritten on a later page or in a collection |
| `- [<]` | < | **scheduled** — belongs to a later month; it goes in the Future Log |
| `- [-]` or `~~text~~` | ~~•~~ | **irrelevant** — no longer worth doing (letting go is a decision) |

## Signifiers

Right after the bullet, before the text:

| Write | Shows as | Means |
|---|---|---|
| `- [ ] * pay taxes` | `*` in the margin | priority — use sparingly |
| `- ! make the hard thing small` | `!` in the margin | inspiration |
| `- [ ] ? heat pumps vs. furnace` | `?` in the margin | explore — look into it |
| `- + why do I keep avoiding the budget` | `+` in the margin | expand later, on another page or in a review |

Rank today's actions with `(1)`, `(2)`, `(3)` after the box if you like: `- [ ] (1) * Q4 numbers`.

## Pages

- A page holds **28 lines**. When it's full, turn the page: `:NotebookNew` in nvim, or `nbd new`.
  The limit is a feature: it keeps entries short and makes you decide what's worth a line.
- **Topic first**: every page starts with what it's about — `# 2026-10-22 Thu` for a daily log,
  or a collection's name (`# Books to read`).
- **Days**: a dated heading `## 2026-10-22 Thu` (`<localleader>d` in nvim) starts a new day.
  Without one, lines belong to the day above them, even across a page turn. Don't date ahead:
  start a day when it starts.
- **Collections**: any page with its own topic (`# Gift ideas`). Continue it later with
  `→ p57` (or `[[p0057]]`) so the thread can be followed. The viewer keeps the index for you.
- **Answering the agent**: write `q7: it's John from design` on any page, or use the viewer.

## Pages that come with the rituals

**Intentions** — who you want to be, one to five lines, kept somewhere you'll see them:

```markdown
# Intentions
- Be curious with my challenges so that I learn instead of getting stuck
- Be present at dinner so that my family gets the best of me
```

**Weekly spread** (weekly ritual) — look back, then plan only what you'll really do:

```markdown
# 2026-W43 review
## Toward my intentions
- shipped the export fix without overtime
## Away
- scrolled past 23:00 three nights
## This week
- [ ] (1) * Q4 numbers to Jane
- [ ] renew passport
- o Thu dinner with Leah — something to look forward to
```

**Monthly log** (monthly ritual) — a timeline and an action plan. 31 days don't fit on a
28-line page: list only the days that matter (or use two pages), one line each, logged as they
happen:

```markdown
# 2026-11
- 03 Tu o dentist 9:00
- 14 Sa o Mom's birthday
## Actions
- [ ] * Q4 numbers to Jane
- [ ] renew passport
```

**Future log** — things that belong to later months:

```markdown
# Future Log
## 2026-12
- [ ] 09: ChemoCo deadline
- o 16: flight to LA
## 2027-01
- [ ] renew driver's licence
```

## Migration

At the end of each week and month, look at every open action and ask: *does this matter? is it
vital? what would happen if it never got done?* Then, by hand:

- still matters → mark the old one `[>]` and rewrite it where it belongs now;
- belongs to a later month → mark it `[<]` and add it to the Future Log;
- doesn't matter → mark it `[-]`.

Rewriting is the filter: if an action isn't worth writing again, it probably isn't worth doing.
`nbd ritual weekly` / `monthly` walks you through it, but the pen is yours.
