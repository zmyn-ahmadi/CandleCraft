# CandleCraft architecture and delivery map

## Current flow

`src/App.tsx` owns the React workspace state and screen navigation. The app loads one `Workspace` object through `src/storage.ts` and queues immediate, ordered saves through `src/saveQueue.ts`. Browser previews use local storage; the Tauri app calls Rust commands in `src-tauri/src/lib.rs`. Rust stores the whole JSON workspace in one SQLite row with WAL and full synchronous commits, plus independent latest and dated JSON recovery copies. `src/model.ts` defines records and metric calculations, while `src/analytics.ts` produces filtered chart series.

The new `src/ImportModal.tsx` uses `src/csv.ts` to parse, map, validate, and preview trade rows before importing them. `src/Replay.tsx` validates OHLC rows and charts only candles through the saved cursor. `src/app.css` is the single stylesheet: layout, feature styling, dark and light themes, and wallpaper choices. Theme colours (`--accent`, `--up`, `--down`, `--card`) are set on `.app.theme-dark` / `.app.theme-light`.

## Feature status against the PRD

| Area | Current behavior | Major work remaining |
| --- | --- | --- |
| Strategy | Versioned rulebooks and checklists | Frozen version validation and stronger change history |
| Trades | Manual lifecycle, costs, R, basic CSV import | Partial fills, import batch undo and conflict review |
| Journal | Notes, tags, checklist assessment, embedded screenshots, MT5 sync with whole-day M2 position charts (`src/mt5.ts`, `src/TradeChart.tsx`) | Managed attachment storage and evidence timing |
| Backtesting | Imported OHLC, saved candle cursor, replay trades with automatic stop/target exits (`simulateExit` in `src/replayData.ts`) and per-dataset session results, plus manual trade records | Immutable datasets and runs, cost assumptions, intrabar data for same-candle stop/target ordering |
| Analytics | Net result, R, win rate, adherence, drawdown, filters, balance and R graphs, reviews | Strategy comparisons and fixed precision |
| Data | Local SQLite JSON document, ordered saves, local recovery copies, JSON export and restore | Structured migrations, integrity hashes, trash and external backup |

## Important data boundaries

- A replay trade enters at the revealed candle's close and exits at the stop or target; when one candle touches both, the stop is assumed first. Results are R × the risk amount entered, without costs. Manual replay records still carry a user-entered result.
- Position sizing uses a user supplied pip value. It does not know contract size or currency conversion.
- JavaScript floating point values are used for money. Production calculations need decimal or scaled integer arithmetic.
- A workspace export includes current records, embedded screenshots, and replay data, but has no manifest or hashes.

## Recommended implementation sequence

1. Migrate workspace JSON to structured SQLite tables with migrations, transactions, and revisioned writes.
2. Add instruments, contract sizes, fixed precision arithmetic, and a deterministic execution engine with tests for stop gaps and ambiguous candles.
3. Add immutable dataset and run records, quality reports, saved decisions, and resume checks.
4. Add managed screenshot attachments and complete, integrity checked backup and restore.
5. Expand imports and analytics after the storage and calculation contracts are stable.
