# CandleCraft 0.1.5 private test release

This is the local desktop build for the one-week trial. It has not been published to GitHub.

## Open it

Search for **CandleCraft** in the application menu, or run `$HOME/.local/opt/candlecraft/0.1.5/CandleCraft.AppImage`.

The Linux AppImage is installed at `$HOME/.local/opt/candlecraft/0.1.5/CandleCraft.AppImage`. The build artifact is in `src-tauri/target/release/bundle/appimage/`. SHA-256 of the installed AppImage:

`98e2fdda9c49ec2d0f3ecf6974169bf17a8a6b3d864b5c8ec9a49838cfd48d2b`

## Your data

The app still uses the existing `app.margin.trading` identifier so the renamed release opens the same workspace at `$HOME/.local/share/app.margin.trading/workspace.db`. Automatic JSON backups are in the adjacent `backups` directory. A separate SQLite snapshot taken before the original trial release is at `$HOME/.local/share/tlog-release-backups/pre-release-2026-10-03.db` and passed `PRAGMA integrity_check`.

Use **Settings & data → Export workspace** to keep a portable copy of the week's entries. Exports now start with `candlecraft-workspace-`.

## Trial notes

Please record any issue with the page, action, expected result, actual result, and whether a restart changes it. Backtesting trade records remain manual; the replay chart does not simulate order fills, stops, spread, or slippage.

The installed AppImage is a fixed build. Source edits made during the week will not change it until a new release is built and installed.

The installed copy was updated on 2026-10-20 with the CandleCraft name and candlestick logo. The existing `tlog.desktop` launcher now opens CandleCraft, preserving its desktop-entry identity. The previous tlog AppImage remains available under `$HOME/.local/opt/tlog/0.1.5/`.
