# fast-csv-reader

A faster drop-in for csv-reader 1.0.0: reads broken CSV files with exactly csv-reader's semantics, using indexOf-driven scanning instead of a character at a time.

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/meviusorg5799/fast-csv-reader/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121/meviusorg5799/fast-csv-reader/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

## How it works

`solve.js` exports `run(input)`, returning `{columns, rows, errors}` for `{text, header}`. An unquoted field is a single slice between the next comma or line break; a quoted field jumps straight to its next quote; the per-character slow paths run only when a stray CR or a line break inside quotes actually shows up. `main.ts` is the driver: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.
