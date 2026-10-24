---
type: project
title: "Auth migration"
description: "You own the auth migration (legacy auth to dual-write, cutover, delete legacy); spike started, design doc next"
created: 2026-10-22
updated: 2026-10-22
status: active
outcome: "Legacy auth replaced and deleted after a safe cutover"
tags: [work]
aliases: [auth migration]
sources:
  - "[[p0003]]"
  - "[[p0004]]"
  - "[[p0006]]"
---
# Auth migration

One of the three Q4 bets; **you own it**.[^p0004] You flagged it as a risk at standup and are anxious about the cutover.

## Outcome
Move from legacy auth through dual-write and cutover to deleting legacy (your diagram on [[p0004]]).

## Where it stands
As of 2026-10-22: spike started ([[p0003]]), design doc not yet written. [[priya]] offered to pair.[^p0003-3]

## Tasks
- [/] auth migration spike ([[p0003]])[^p0003-2]
- [ ] write auth migration design doc ([[p0004]])[^p0004-2]

- [ ] * send [[jordan-lee|Jordan]] the dual-write notes from the spike ([[p0006]])[^p0006]

## Decisions
- Frame it as a bet: state the bet, the signal, the stop condition (inspiration, not yet applied).[^p0004-3]

## Log
- 2026-10-23: [[jordan-lee|Jordan]] ("J.") wants the dual-write notes from the spike. See [[2026-10-23]].
- 2026-10-22: owner at the offsite; design doc task added. See [[2026-10-22]].
- 2026-10-21: spike started. See [[2026-10-21]].
- 2026-10-20: risk flagged at standup. See [[2026-10-20]].

## Related
[[q4-roadmap]], [[priya]], [[jordan-lee]]

[^p0003]: [[p0003]] · "standup: flagged auth migration risk"
[^p0003-2]: [[p0003]] · "auth migration spike"
[^p0003-3]: [[p0003]] · "offered to pair on the auth migration"
[^p0006]: [[p0006]] · "send J. the dual-write notes"
[^p0004]: [[p0004]] · "I own auth migration"
[^p0004-2]: [[p0004]] · "write auth migration design doc"
[^p0004-3]: [[p0004]] · "state the bet, the signal, the stop condition"
