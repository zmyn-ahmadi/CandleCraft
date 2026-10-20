# CandleCraft

CandleCraft is a local trading journal desktop app based on the requirements in `Trading_Desktop_App_PRD.docx`.

## Current build

- Tauri 2 desktop shell with a React interface and local SQLite workspace file.
- Separate live, demo, and backtest views; multiple accounts with separate currencies.
- Strategy rulebooks with preserved versions and required or optional checklist items.
- Manual trade records with status, initial risk, signed costs, source, and journal fields.
- Trade log, journal, dashboard, performance metrics, and dated weekly review snapshots.
- Standalone Risk Management worksheet with saved rules, position sizing, manual circuit checks, and performance calculations.
- Canvas Studio collections with multiple saved boards, drawing tools, movable notes, attached pictures, undo/redo, and zoom.
- Portable JSON export and restore of current workspace records; automatic local recovery copies on desktop.
- Light and dark themes, keyboard focus states, and `N` for a new trade when no text field is active.

The interface uses a restrained glass layout with dark and light modes, three built in wallpapers, and an optional local image wallpaper. New workspaces start in dark mode with an AUD account. Existing USD trades keep their currency; an AUD account is added and selected when needed. The dashboard includes a position sizing estimate using user supplied pip value per lot. Trade log CSV import supports column mapping, row preview, validation, duplicate skipping, and a choice between gross and already net profit. Backtesting accepts local OHLC CSV files and saves a candle replay cursor; the chart only plots revealed candles. Trades recorded from replay are manual records. Journal entries can include before and after chart screenshots, stored in the workspace and JSON export, with a 1 MB limit per image.

Desktop saves are queued in order and sent immediately after a workspace change. SQLite uses WAL and full synchronous commits. A latest JSON copy and one dated copy per UTC day are written in the app data `backups` directory; Settings shows that path. If the SQLite workspace record is damaged, the app archives it, restores the newest valid local copy, and displays a recovery notice. Browser preview has a smaller local storage fallback copy. A failed load never silently saves an empty workspace over the damaged data. Restoring a JSON export is validated and persisted before the app reports success.

Analytics now share one outcome classification based on the account currency's displayed precision. The analytics page filters by date, pair, strategy, and direction and offers realised balance and cumulative R graphs. Graph points open their underlying trade; for large histories the chart reduces point markers while retaining the full line.

This remains an early implementation increment. Replay does not calculate simulated fills, stops, targets, spreads, slippage, or commissions. Dataset import does not yet report missing intervals or store full provenance. CSV import does not support partial fills, batch undo, or conflict resolution. Screenshots are stored as data URLs inside the workspace rather than in a managed attachment directory. Backups are on the same device and do not include integrity hashes. Structured SQLite tables are outstanding. Financial inputs currently use JavaScript numbers and require fixed precision calculations before production use.

## CSV formats

Trade imports expect a header row. Map instrument, direction, entry date, and profit or loss; optional columns include exit date, fees, swap, spread, initial risk, trade ID, size, entry/exit/stop/target prices, balance before entry, value per price unit, setup tag, rule adherence, and exit reason. Directions accept `buy`/`sell` or `long`/`short`. Rule adherence accepts `yes`, `no`, or `unassessed`; exit reason accepts `target`, `stop`, `manual`, `trailing`, or `other`. Dates need an unambiguous year. If profit is already net, select that option so fees, swap, and spread are not added again. Existing imports remain valid and missing risk fields are shown as unassessed.

The Risk Management tab is a separate AUD worksheet. Enter the balance, personal limits, hypothetical entry/stop/target, daily figures, equity peaks, ordered equity checkpoints, and a rolling 20–30 result sample manually. It calculates cash risk, size, reward:risk, daily budget, current drawdown, historical maximum drawdown, expectancy, profit factor, and discipline, and shows reminders when entered figures meet a rule. Its notes and values persist in the workspace and JSON exports. The worksheet does not read or change trades, prevent trade entry, or place or close broker orders. Legacy risk profile data from 0.1.1 is retained; threshold settings are copied into the new worksheet on first load.

Canvas Studio lets you create collections and multiple canvases within each collection. Each canvas is infinite: scroll to pan in any direction, use the Hand tool to drag the view, and Ctrl/Command + scroll to zoom around the pointer. Fit all content returns distant items to view. The Text tool places editable text directly on the canvas with color and font size controls. Each board supports pen and highlighter strokes, lines, arrows, rectangles, movable and resizable notes and pictures, background styles, zoom, pan, and undo/redo during the current session. Add PNG, JPEG, or WebP pictures with the toolbar, drag-and-drop, or clipboard paste; pictures are optimized and stored inside the workspace so they are included in JSON exports and local backups. Picture uploads are limited to 12 MB before optimization and 4 MB of stored image data. Deleting a collection or canvas requires confirmation; undo history is kept for the current session rather than persisted across app restarts.

Replay imports expect date/time, open, high, low, and close columns, with optional volume. Ascending and newest-first files are accepted; dates are stored in UTC. The chart shows only revealed candles. Timeframe buttons offer the source interval and larger UTC periods, with OHLCV aggregation; a daily file cannot create intraday candles. The chart has candlestick and close-line modes, crosshair, volume, SMA 20/50, EMA 20, RSI 14, zoom, panning, history navigation, trendlines, rays, horizontal and vertical markers, price zones, Fibonacci retracements, and measurement. Drawings can be selected, edited by dragging their handles, undone, or deleted. Drawings, timeframe, and replay cursor are saved in the workspace. Importing another file replaces the active replay dataset and drawings; existing backtest trade records remain in the journal. Indicators need their full period of revealed bars.

## Run

```sh
npm install
npm run tauri dev
```

For a browser preview without the desktop shell, use `npm run dev`. Browser preview data is stored in local storage; Tauri data is stored in the operating system's application data directory.

## Checks

```sh
npm run build
npm test
cd src-tauri && cargo check
cd src-tauri && cargo test
```

The frontend build, analytics and save queue tests, Rust check, and Rust storage tests pass in this workspace.
