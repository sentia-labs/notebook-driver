# Notebook

This is a notebook home for notebook-driver: paper-like pages you write by
hand, and a second brain an AI agent keeps for you.

```
notebook/     your pages, p0001.md … — 28 lines each. Yours alone: the agent only reads them.
vault/        the second brain the agent maintains from your pages. Browse it; don't edit it.
  index.md    catalog of every note (generated)       inbox/      the agent's questions for you
  log.md      what the agent did, when                 journal/    daily … yearly logs and reviews
  overview.md the big picture                          projects/ areas/ resources/ archive/  (PARA)
KEY.md        how to write: bullets, task states, signifiers, pages
AGENTS.md     the agent's instructions (edit to change how it works)
nbd.json      settings: page size, when the agent runs, which agent, ritual times
.nbd/         tool state (not versioned)
```

Everyday use:

| | |
|---|---|
| write | nvim: `:Notebook` (current page), `:NotebookNew` (turn the page) |
| read | the viewer: `nbd serve` → http://127.0.0.1:4242 (the daemon serves it too) |
| keep it running | `nbd service install` (watches pages, runs the agent, notifies you) |
| answer questions | viewer Inbox, `:NotebookQuestions`, `nbd answer q0007 "…"`, or `q7: …` on a page |
| reflect | `nbd ritual weekly` · `monthly` · `quarterly` · `yearly` |
| ask | `nbd ask "what did I decide about the budget?"` |

Keep this folder in git if you like: everything except `.nbd/` is worth versioning.
