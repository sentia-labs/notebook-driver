# Demo notebook (seed)

Six hand-written pages (`notebook/`) and the vault Claude Code built from them (`vault/`): real
agent output, including the question it asked ("Who is J.?") and how it applied the answer. Names
and events are made up.

This folder is the **seed**: it stays as committed and nothing runs on it. To use the demo:

```sh
nbd demo                  # create the demo notebook (first time) and run it → http://127.0.0.1:4243
nbd demo --reset          # back to this seed: its pages, and the vault built from them
nbd demo --reset --fresh  # pages only: the first ingest builds the vault in front of you
nbd demo --path           # where it lives (~/.local/share/notebook-driver/demo, or $NBD_DEMO_HOME)
```

The demo is an ordinary notebook home, made by `nbd init` and run by `nbd daemon`: same agent,
ingest, notifications, rituals and viewer as your own notebook, which makes it the place to try
and QA changes. Its settings differ only in [`nbd.json`](nbd.json): its name, port 4243 (so it can
run next to your notebook on 4242) and a 60 s ingest delay instead of 5 min. Reset is also a
button in the viewer's Activity page, and the log (`nbd logs --home "$(nbd demo --path)"`) is
kept across resets.

To edit pages in nvim against the demo: `NBD_HOME="$(nbd demo --path)" nvim`.
To change the seed itself, edit these files and commit; `nbd demo --reset` picks them up.
