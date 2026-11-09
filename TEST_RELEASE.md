# CandleCraft 0.1.6 private test release

This is the local desktop build for the one-week trial. It has not been published to GitHub.

## Open it

Search for **CandleCraft** in the application menu, or run `$HOME/.local/opt/candlecraft/0.1.6/CandleCraft.AppImage`.

The Linux AppImage is installed at `$HOME/.local/opt/candlecraft/0.1.6/CandleCraft.AppImage`. The build artifact is in `src-tauri/target/release/bundle/appimage/`. SHA-256 of the installed AppImage:

`217d5500de70c22c5af7cfb6d2c27d893bb93c6f495c2fe453276e915eb887f3`

## What's new in 0.1.6

MT5 journal: Settings → MetaTrader 5 takes the mt5-api address and token. The Journal tab then syncs every MT5 position and opens each trade on a whole-day M2 chart with its entry, exit, SL/TP zones and R. See README → MetaTrader 5 journal. The mt5-api it points at needs the `/rates` endpoint and CORS from `~/Trading/mt5-api/main.py`.

## Your data

0.1.6 opens the same workspace with no conversion step. The 83 trades the sync skill had logged (`mt5:` refs, Live · FusionMarket) are matched by ref on the first sync and gain their chart link; nothing else on them changes, no duplicates are added, and the 30 hand-entered trades are untouched. This was dry-run on a copy of the workspace against the live MT5 history, and the 0.1.6 AppImage was launched on a copy before install: all 113 trades unchanged, `PRAGMA integrity_check` ok. Chart candles are kept in a new `candle_cache` table beside the workspace. A snapshot taken before upgrading is at `$HOME/.local/share/app.margin.trading/manual-snapshots/workspace-before-mt5-journal-0.1.6.db`; 0.1.5 remains at `$HOME/.local/opt/candlecraft/0.1.5/`.


The app still uses the existing `app.margin.trading` identifier so the renamed release opens the same workspace at `$HOME/.local/share/app.margin.trading/workspace.db`. Automatic JSON backups are in the adjacent `backups` directory. A separate SQLite snapshot taken before the original trial release is at `$HOME/.local/share/tlog-release-backups/pre-release-2026-10-03.db` and passed `PRAGMA integrity_check`.

Use **Settings & data → Export workspace** to keep a portable copy of the week's entries. Exports now start with `candlecraft-workspace-`.

## Trial notes

Please record any issue with the page, action, expected result, actual result, and whether a restart changes it. Backtesting trade records remain manual; the replay chart does not simulate order fills, stops, spread, or slippage.

The installed AppImage is a fixed build. Source edits made during the week will not change it until a new release is built and installed.

The installed copy was updated on 2026-10-20 with the CandleCraft name and candlestick logo. The existing `tlog.desktop` launcher now opens CandleCraft, preserving its desktop-entry identity. The previous tlog AppImage remains available under `$HOME/.local/opt/tlog/0.1.5/`.
