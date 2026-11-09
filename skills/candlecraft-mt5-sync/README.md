# CandleCraft MT5 sync

Records a day's MetaTrader 5 positions as trade entries in CandleCraft. It reads them from your mt5-api on the home server over Tailscale, and writes them with the `candlecraft` CLI.

Only trade fields are filled in. Reasoning, notes, lessons, tags and checklist answers are left for you to write in the app.

**The app can do this itself.** In CandleCraft, fill in Settings → MetaTrader 5 (server address and token). The app then syncs every position when it opens, every minute in the background, and from the Sync MT5 button on the Trades screen, and shows each trade on a whole-day M2 chart with entry/exit, SL/TP zones and R. Use this skill when the app is closed or you'd rather ask an agent; both write the same trades under the same key.

## Setup (once)

1. Make sure Tailscale is connected on this machine and the `mt5-api` service is running on the server.
2. Put these in `~/.config/zsh/.zshrc`:
   ```sh
   export MT5_API_URL=https://your-server.your-tailnet.ts.net
   export MT5_API_TOKEN=<token from /etc/mt5-api.env on the server>
   ```
3. Build the CLI:
   ```sh
   cd ~/Projects/CandleCraft/src-tauri && cargo build --release --bin candlecraft
   ```
4. For Claude Code, the skill is linked at `~/.claude/skills/candlecraft-mt5-sync`, so it works from any folder.

## Using it with an AI agent

Ask in plain words:

- "Add today's trades to CandleCraft"
- "Sync my MT5 positions for yesterday"
- "Log my trades from 2026-10-27 into the journal"
- "Fill last Friday's positions into CandleCraft"
- "Update today's trades in CandleCraft". Use this after an open trade closes.

Or call it by name: `/candlecraft-mt5-sync 2026-10-28`.

You can add options to the request:

- "…into my demo account": picks a different CandleCraft account.
- "…as backtest": records them under a different environment.
- "…look back 180 days": use this if a position was opened long before the date.

The agent then:

1. Works out the date (broker server date, as shown in the MT5 terminal).
2. Does a dry run and shows you what it found.
3. Asks whether CandleCraft is open. If it is and has MT5 settings, it tells you the app is already syncing (or to press Sync MT5 on the Trades screen). Otherwise it asks you to close it.
4. Writes the trades and reports what was added or updated.

## Using it without an agent

```sh
cd ~/Projects/CandleCraft
python3 skills/candlecraft-mt5-sync/scripts/sync.py 2026-10-28 --dry-run   # show only
python3 skills/candlecraft-mt5-sync/scripts/sync.py 2026-10-28             # write
```

| Option | Meaning |
|---|---|
| `DATE` | `YYYY-MM-DD`, broker server date. Default: today |
| `--account <id\|name>` | CandleCraft account. Default: the one whose currency matches the MT5 account |
| `--env live\|demo\|backtest` | Default: from the MT5 account type (real → live, otherwise demo) |
| `--lookback N` | Days before the date to search for opening deals. Default 90 |
| `--dry-run` | Print the CLI commands without writing |

To list CandleCraft accounts or strategies: `src-tauri/target/release/candlecraft accounts` and `src-tauri/target/release/candlecraft strategies`.

**Close the CandleCraft app before writing.** It keeps its own copy in memory and saves that over the file, so trades written while it is open are lost. If the app is open with MT5 settings, it already syncs on its own.

## What gets recorded

A position is included if it opened or closed on the date.

| CandleCraft field | From MT5 |
|---|---|
| Symbol | Deal symbol, broker suffix dropped (`AUDUSD.r` → `AUDUSD`) |
| Direction | Opening deal: buy → long, sell → short |
| Status | `closed` if fully closed, otherwise `open` |
| Entry / exit date | Server date of the first opening deal / last closing deal |
| Entry / exit price | Volume-weighted across partial fills |
| Size | Total lots opened |
| Initial stop / target | SL / TP on the opening order; if the order had none, the price of the SL / TP exit that closed it |
| Gross P/L, swap | Summed across the position's deals (closed trades only) |
| Fees | Commission plus fee across all deals |
| Exit reason | SL → `stop` (or `trailing` if it closed in profit), TP → `target`, otherwise `manual` |
| External ref | `mt5:<position id>` |

## Running it again

Each trade is keyed by `mt5:<position id>` and the account, so a sync can be repeated safely. Running it again:

- updates the same entry (for example, an open trade that has since closed);
- keeps your journal notes, strategy, setup tag, rule adherence, screenshots and the app's MT5 chart link;
- never creates duplicates.

A good habit is to sync at the end of each trading day, and to sync again any day that had a trade still open.

## Limits

- Initial risk is not filled, because it needs the symbol's contract size. Add it in the app.
- A partly closed position stays `open`, without realised P/L, until it is fully closed.
- Netting-account reversals are not split into two trades.

## Troubleshooting

| Message | Fix |
|---|---|
| `Set MT5_API_URL` / `Set MT5_API_TOKEN` | Add the exports above, then open a new shell |
| `mt5-api not reachable` | Run `tailscale status` here, and `systemctl status mt5-api` on the server |
| `HTTP 401` | The token doesn't match `/etc/mt5-api.env` on the server |
| `candlecraft CLI not found` | Build it (setup step 3), or set `CANDLECRAFT_BIN` |
| `N CandleCraft accounts use AUD` | Pass `--account <id>` (or name the account to the agent) |
| `skipped mt5:…: opening deal is older` | Raise `--lookback` |
| `no workspace` | Open CandleCraft once so it creates its workspace |

Check the script itself with `python3 skills/candlecraft-mt5-sync/scripts/sync.py --self-test`, which prints `ok`.
