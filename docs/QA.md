# QA on the demo notebook

The demo is an ordinary notebook home made from the seed in [`examples/demo`](../examples/demo)
and run by the normal daemon, so everything below exercises the same code as your own notebook.
Nothing here is mocked: agent steps use your configured harness and cost what a real run costs
(about $0.25 for the six-page ingest with Sonnet, a few cents for an ask or a review turn).

```sh
nbd demo                      # → http://127.0.0.1:4243 (runs next to your notebook on 4242)
nbd logs -f --demo            # second terminal: every step below leaves lines here
NBD_HOME="$(nbd demo --path)" nvim     # to test the nvim side against the demo
```

Reset between passes with **Activity → Reset the demo** (`nbd demo --reset`), or **Reset to pages
only** (`nbd demo --reset --fresh`) to test the first ingest from an empty vault. Resets keep the
log, so a QA pass reads as one story in `nbd logs`.

Each check names the button, the command that does the same, and what to expect.

## Ingest

| Do | Same from a terminal | Expect |
| --- | --- | --- |
| Reset to pages only, then wait | `nbd demo --reset --fresh` | Within seconds the pill says *Agent working…*; Activity shows each step live (*Reading notebook/p0003.md*, *Writing vault/…*); ~80 s later a toast, ~15 new notes, an Inbox question about "J." |
| Edit a page in nvim, save, wait 60 s | — | `watch changed rel=notebook/p000N.md`, then an automatic ingest of that page only |
| **Ingest this page now** on a changed page | `nbd sync --page p0006 --demo` | Runs at once; the page's *In the vault* panel updates |
| **Skip** in Activity → Waiting to be read | `nbd sync --skip --page p0006 --demo` | Page leaves the list, no agent run; editing it again brings it back |
| **Preview what the agent would be told** | `nbd sync --dry-run --demo` | The exact prompt, nothing run |

## Pages

| Do | Same from a terminal | Expect |
| --- | --- | --- |
| **New page** (Today or Pages, optional topic) | `nbd new --topic "Books" --demo` | Opens the new page; the command under the field tracks what you type |
| **Open in editor** | `nbd edit p0006 --demo` | nvim opens in your terminal at the page |
| Fill a page to 28 lines, then 29 | — | "Page N is full" notification, then a critical "overflows" one; ingest starts ~30 s after the page fills |

## Questions, ask, rituals

| Do | Same from a terminal | Expect |
| --- | --- | --- |
| Answer a question in **Inbox** | `nbd answer q0001 "Jordan Lee" --demo` | ~60 s later the question is resolved and a person note exists |
| **Ask** "What's still open on the auth migration?" | `nbd ask "…" --demo` | Steps live, an answer citing `p.3`/`p.4`/`p.6`; follow-ups continue the session (`nbd ask --resume <session> "…" --demo`) |
| **Rituals → Start the review** (weekly) | `nbd ritual weekly --period 2026-W43 --demo` | The agent writes `vault/journal/weekly/2026-W43.md` (`review: pending`) and shows one numbered list of proposals for the open actions; reply `ok` and it drafts the `# 2026-W44` page and the marks on old pages in code blocks; no reflective questions; *From a terminal* gives `claude --resume …` |
| **Rituals → Timings** after a review turn | `nbd rituals --runs --demo` | One row for the run: active minutes, agent and your minutes, replies, cost, done |
| **Activity → Clean up with the agent** | `nbd lint --agent --demo` | A conversation that works through lint findings with you |

## Safety and operations

| Do | Same from a terminal | Expect |
| --- | --- | --- |
| In a review, ask the agent to "fix the typo on p0006" | — | It declines or is denied; a `guard` line in the log if it tried through the shell; `nbd status --demo` shows the page unchanged |
| Stop the demo (Ctrl-C) while an ingest runs | — | `stopping the running agent` then `the agent stopped`; no `claude -p` left running |
| **Run the checks** in Activity | `nbd doctor --demo` | All green except optional items |
| Open 8+ tabs of the demo | — | All load quickly (tabs share one live connection) |
| `nbd daemon --home examples/demo` | — | Refused: the seed stays as committed |

## Changing the seed

Edit the files in `examples/demo` and commit them; the next `nbd demo --reset` uses them. To
re-record the seed vault from a real run: `nbd demo --reset --fresh`, let the ingest finish, check
it, then copy the demo's `vault/` over `examples/demo/vault/`.
