# Demo data (recorded sessions)

`/chat?demo=1` lists the demo cases, `/chat?demo=<case>` replays one. "Ukázky s demo daty" in the sidebar opens the list; a demo chat has a switch in the top bar. No API, no LLM, no key: the UI replays static files from `services/frontend/public/demo/`.

A demo is a **real run of the whole backend** where only the LLM steps were written by hand:

```
scenarios/demo/<case>.json   hand-written: 01_company, 03_influences, what-ifs, detective report
scenarios/<case>.json        hand-written 05_scenario (02_model and 04_story are cut from it)
        │  pnpm demo:record [case...]
        ▼
real orchestrator ─ demo cascade port (serves the files above instead of A1–A5 / what-if)
                  ─ real noiser (engine, seed 42, UI default noise: 2 % missing, 1 % duplicates, ts)
                  ─ real dataer (DuckDB, FK integrity, evidence, compare, export)
                  ─ detective port: the hand-written report, its SQL run on the sandbox, scored vs truth
        ▼
services/frontend/public/demo/<case>.json      events per command + every GET the UI makes
services/frontend/public/demo/<case>/<case>_dat1.xlsx   the first dataset, as the export button serves it
services/frontend/public/demo/index.json       the picker's list
```

In the browser, `createDemoSource` loads the bundle and runs the **live presenter** (`liveSource.ts`) on a replay transport (`demoTransport.ts`) instead of HTTP + SSE, so a demo looks exactly like a live session. Differences, all on purpose:

- The story is fixed (read-only curve, no seed/noise settings): its data already exists.
- Only the recorded what-if questions are answered (offered as quick replies); others are refused with the list.
- The detective is recorded for `dat1`; export offers the recorded `.xlsx` of `dat1`.
- Events are paced like a short run (`eventDelay`), not the recorded wall-clock time.

## Cases

| Case            | Story                                                                    | Tables / rows | Detective recall |
| --------------- | ------------------------------------------------------------------------ | ------------- | ---------------- |
| `eshop_carrier` | E-shop, main carrier delays → tickets, bad reviews, returns, fewer orders | 9 / 36 042    | 3/3              |
| `isp_firmware`  | ISP firmware breaks one router model → outages, overloaded hotline, churn | 11 / 41 506   | 3/3              |
| `card_fraud`    | Neobank card-testing attack → declines, reports, blocks, chargebacks, 3DS | 7 / 45 145    | 2/3              |

Each passes the same gates as LLM output (`services/api/tests/integration/demo.test.ts`): the cascade's 04_story / influence / roots checks, lead-in ≤ 120 days, the story gate (integrity, every hypothesis, flat baseline) at seed 42 and at ≥ 4 of seeds 1..5. Golden hashes: `services/noiser/tests/golden/demo_cases.*`.

## Changing or adding a case

1. Edit `scenarios/<case>.json` (check with `pnpm gen scenarios/<case>.json`) and/or `scenarios/demo/<case>.json` (`DemoCase` in `@s2d/schema/demo`).
2. `pnpm demo:record <case>` (about 20 s per case). It refuses to write a bundle if integrity, a hypothesis or a detective SQL fails.
3. `UPDATE_GOLDEN=1 pnpm vitest run services/noiser/tests/golden` if the scenario changed.
4. Commit the scenario, the case and `services/frontend/public/demo/` together. The integration test re-records every case and compares it with the committed bundle byte for byte (recording is deterministic), so a stale bundle fails CI.

Detective findings must be what the data shows: write them from queries on `out/<case>_seed42.duckdb` (`pnpm gen`), not from the scenario. Findings that name no story entity are kept (they lower precision, like a real detective's side remarks).
