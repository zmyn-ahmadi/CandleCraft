# CandleCraft architecture and delivery map

## Current flow

`src/App.tsx` owns the React workspace state and screen navigation. The app loads one `Workspace` object through `src/storage.ts` and queues immediate, ordered saves through `src/saveQueue.ts`. Browser previews use local storage; the Tauri app calls Rust commands in `src-tauri/src/lib.rs`. Rust stores the whole JSON workspace in one SQLite row with WAL and full synchronous commits, plus independent latest and dated JSON recovery copies. `src/model.ts` defines records and metric calculations, while `src/analytics.ts` produces filtered chart series.

The new `src/ImportModal.tsx` uses `src/csv.ts` to parse, map, validate, and preview trade rows before importing them. `src/Replay.tsx` validates OHLC rows and charts only candles through the saved cursor. `src/styles.css` contains the original layout, `src/glass.css` adds feature styling, and `src/sleek.css` defines the current dark and light glass themes and wallpaper choices.

## Feature status against the PRD

| Area | Current behavior | Major work remaining |
| --- | --- | --- |
| Strategy | Versioned rulebooks and checklists | Frozen version validation and stronger change history |
| Trades | Manual lifecycle, costs, R, basic CSV import | Partial fills, import batch undo and conflict review |
| Journal | Notes, tags, checklist assessment, embedded screenshots | Managed attachment storage and evidence timing |
| Backtesting | Imported OHLC, saved manual candle cursor, manual trade record | Immutable datasets and runs, execution engine, cost assumptions, gap handling |
| Analytics | Net result, R, win rate, adherence, drawdown, filters, balance and R graphs, reviews | Strategy comparisons and fixed precision |
| Data | Local SQLite JSON document, ordered saves, local recovery copies, JSON export and restore | Structured migrations, integrity hashes, trash and external backup |

## Important data boundaries

- A replay trade currently records a user entered result. It is not a simulated fill.
- Position sizing uses a user supplied pip value. It does not know contract size or currency conversion.
- JavaScript floating point values are used for money. Production calculations need decimal or scaled integer arithmetic.
- A workspace export includes current records, embedded screenshots, and replay data, but has no manifest or hashes.

## Recommended implementation sequence

1. Migrate workspace JSON to structured SQLite tables with migrations, transactions, and revisioned writes.
2. Add instruments, contract sizes, fixed precision arithmetic, and a deterministic execution engine with tests for stop gaps and ambiguous candles.
3. Add immutable dataset and run records, quality reports, saved decisions, and resume checks.
4. Add managed screenshot attachments and complete, integrity checked backup and restore.
5. Expand imports and analytics after the storage and calculation contracts are stable.
