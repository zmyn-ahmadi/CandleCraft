---
name: candlecraft-mt5-sync
description: Pull a day's open and closed MT5 positions from the user's mt5-api (on their home server, over Tailscale) and record them as trade entries in the CandleCraft journal app. Use when the user says "add today's trades to CandleCraft", "sync my MT5 positions for 2026-10-28", "fill yesterday's trades into the journal", "log my positions", or similar.
---

# CandleCraft MT5 sync

Records MT5 positions as CandleCraft trade entries. Trade fields only (symbol, direction, dates, prices, size, stop, target, P/L, commission, swap, exit reason); journal fields stay empty for the user to write in the app.

CandleCraft also syncs MT5 by itself: it pulls every position from the same mt5-api in the background, keeps it updated every minute while the app is open, and shows each trade on a whole-day M2 chart with its SL/TP zones and R. Both paths write identical trades under the same `mt5:<position id>` ref, so they never duplicate. This skill is for when the app is closed, or the user wants an agent to do it.

Script: `scripts/sync.py` next to this file (Python 3 stdlib, no install).

## Steps

1. **Resolve the date** the user means to `YYYY-MM-DD` ("today", "yesterday", "last Friday"). Dates are the broker's server date, as shown in the MT5 terminal. Without a date, use today.
2. **Check prerequisites**
   - `MT5_API_URL` (the server's Tailscale address, e.g. `https://homeserver.tailnet.ts.net`) and `MT5_API_TOKEN` are set. If not, ask the user to add them to their shell profile; never print the token.
   - The API is reachable: if the script says it is not, tell the user to check that Tailscale is connected on this machine (`tailscale status`) and that the `mt5-api` service is running on the server (`systemctl status mt5-api`). Do not try to fix the server yourself.
   - The `candlecraft` CLI exists. If the script says it is not found, build it: `cd ~/Projects/CandleCraft/src-tauri && cargo build --release --bin candlecraft`.
3. **Dry run** and show the user the positions it found:
   ```sh
   python3 scripts/sync.py 2026-10-28 --dry-run
   ```
4. **Ask whether the CandleCraft desktop app is open.**
   - Open, with Settings → MetaTrader 5 filled in: don't write. Tell the user the app already syncs on its own every minute, or they can press Sync MT5 on the Trades screen. Stop here.
   - Open, without MT5 settings: ask them to close it, then confirm. The app saves its in-memory copy over the workspace file, so entries written while it is open are lost. Mention that filling in Settings → MetaTrader 5 lets the app sync and chart trades itself.
   - Closed: continue.
5. **Write**:
   ```sh
   python3 scripts/sync.py 2026-10-28
   ```
6. **Report** each `added` / `updated` line, and any `skipped` warnings, in a short table. Tell the user they can reopen the app; a trade's chart appears once the app has synced it (with MT5 settings filled in).

## Options

- `--account <id|name>`: CandleCraft account. Default is the single account whose currency matches the MT5 account; if there are zero or several, the script lists them and you must ask which one.
- `--env live|demo|backtest`: default comes from the MT5 account type (real → live, otherwise demo).
- `--lookback N`: days before the date to search for opening deals (default 90). Raise it if a position is skipped.

## Behaviour

- A position is included if it opened or closed on the date. Its current state is recorded: fully closed → `closed` with exit price, gross P/L, swap and exit reason (MT5 SL → stop, or trailing if it closed in profit; TP → target; else manual). Broker symbol suffixes are dropped (`AUDUSD.r` → `AUDUSD`); still open → `open` with entry, size, stop and target.
- Prices are volume-weighted across partial fills. Fees are commission plus fee across all deals. Initial stop and target come from the opening order; when the order had none, a stop or target that closed the trade is taken from that exit's price.
- Field mapping is shared with the app (`src/mt5.ts`); `tests/mt5.test.mjs` uses this script's self-test fixture. Change both together.
- Each trade is keyed `mt5:<position id>` per account. Re-running is safe: it updates the same entry (for example open → closed) and keeps the user's journal notes, strategy, setup tag, screenshots and the app's MT5 chart link.
- Initial risk is not filled (it needs contract size); the user can add it in the app.
- Partly closed positions stay `open` without realised P/L until fully closed. Netting-account reversals are not split.

## Self-check

`python3 scripts/sync.py --self-test` prints `ok`.
