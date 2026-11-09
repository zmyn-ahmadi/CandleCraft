#!/usr/bin/env python3
"""Copy one day's MT5 positions into CandleCraft through the `candlecraft` CLI.

A position is included when any of its deals (open or close) falls on the date, in broker
server time, the same clock the MT5 terminal shows. Each trade is keyed `mt5:<position id>`,
so re-running updates the existing entry (open -> closed) and keeps journal notes.

Env: MT5_API_URL (required, e.g. https://homeserver.tailnet.ts.net), MT5_API_TOKEN (required),
     CANDLECRAFT_BIN (default: `candlecraft` on PATH, then this repo's release build).
"""
import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

BUY, SELL = 0, 1
IN, OUT, OUT_BY = 0, 1, 3
SL_HIT, TP_HIT = 4, 5  # DEAL_REASON_SL, DEAL_REASON_TP
EXIT_REASON = {SL_HIT: "stop", TP_HIT: "target"}  # everything else is manual


def day(ts):
    return datetime.fromtimestamp(ts, timezone.utc).date().isoformat()


def vwap(deals):
    volume = sum(d["volume"] for d in deals)
    return round(sum(d["price"] * d["volume"] for d in deals) / volume, 10) if volume else None


def money(deals, *keys):
    return round(sum(d.get(k, 0.0) for d in deals for k in keys), 2)


def build(target, deals, orders, open_positions, env):
    """Returns (trades, skipped): trades are CLI flag dicts for positions touching `target`."""
    by_position = defaultdict(list)
    for d in deals:
        if d["type"] in (BUY, SELL) and d["position_id"]:
            by_position[d["position_id"]].append(d)
    stops = {o["ticket"]: (o.get("sl") or None, o.get("tp") or None) for o in orders}
    still_open = {p.get("identifier") or p["ticket"] for p in open_positions}

    trades, skipped = [], []
    for position, ds in sorted(by_position.items()):
        ds.sort(key=lambda d: d["time_msc"])
        if target not in {day(d["time"]) for d in ds}:
            continue
        ins = [d for d in ds if d["entry"] == IN]
        outs = [d for d in ds if d["entry"] in (OUT, OUT_BY)]
        if not ins:
            skipped.append(position)  # opened before the lookback window
            continue
        # ponytail: hedging accounts only; netting-account INOUT reversals are not split into two trades.
        first, closed = ins[0], position not in still_open
        stop, target_price = stops.get(first["order"], (None, None))
        last = outs[-1] if closed and outs else None
        # A level added after the order was sent is only known from the exit that hit it (same rule as the app's src/mt5.ts).
        stop = stop or (last["price"] if last and last["reason"] == SL_HIT else None)
        target_price = target_price or (last["price"] if last and last["reason"] == TP_HIT else None)
        t = {
            "symbol": first["symbol"].split(".")[0],  # drop broker suffix: AUDUSD.r -> AUDUSD
            "direction": "long" if first["type"] == BUY else "short",
            "env": env,
            "status": "closed" if closed else "open",
            "entered": day(first["time"]),
            "exited": day(outs[-1]["time"]) if closed and outs else day(first["time"]),
            "entry": vwap(ins),
            "size": round(sum(d["volume"] for d in ins), 4),
            "stop": stop,
            "target": target_price,
            "fees": money(ds, "commission", "fee"),
            "ref": f"mt5:{position}",
        }
        # ponytail: a partly closed position stays "open" without its realised P/L until it is fully closed.
        if closed:
            gross = money(ds, "profit")
            reason = EXIT_REASON.get(outs[-1]["reason"], "manual") if outs else "manual"
            t |= {"exit": vwap(outs), "gross": gross, "swap": money(ds, "swap"),
                  "exit-reason": "trailing" if reason == "stop" and gross > 0 else reason}  # stop moved into profit
        trades.append({k: v for k, v in t.items() if v is not None})
    return trades, skipped


def api(path):
    base = os.getenv("MT5_API_URL") or sys.exit("Set MT5_API_URL to the mt5-api address, e.g. https://homeserver.tailnet.ts.net")
    token = os.getenv("MT5_API_TOKEN") or sys.exit("Set MT5_API_TOKEN (the mt5-api bearer token)")
    url = base.rstrip("/") + path
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as e:
        sys.exit(f"mt5-api {path}: HTTP {e.code} {e.read().decode(errors='replace')[:300]}")
    except urllib.error.URLError as e:
        sys.exit(f"mt5-api not reachable at {url}: {e.reason} (is Tailscale up on this machine, and the mt5-api service running on the server?)")


def cli_bin():
    found = os.getenv("CANDLECRAFT_BIN") or shutil.which("candlecraft")
    repo = Path(__file__).resolve().parents[3] / "src-tauri/target/release/candlecraft"
    if found:
        return found
    if repo.exists():
        return str(repo)
    sys.exit("candlecraft CLI not found: build it with `cd src-tauri && cargo build --release --bin candlecraft` or set CANDLECRAFT_BIN")


def pick_account(binary, currency):
    out = subprocess.run([binary, "accounts"], capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr.strip())
    matches = [line.split("\t")[0] for line in out.stdout.splitlines() if line.split("\t")[1:2] == [currency]]
    if len(matches) != 1:
        sys.exit(f"{len(matches)} CandleCraft accounts use {currency}; pass --account <id>. Accounts:\n{out.stdout}")
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("date", nargs="?", default=date.today().isoformat(), help="YYYY-MM-DD, broker server date (default: today)")
    parser.add_argument("--account", help="CandleCraft account id or name (default: the one matching the MT5 currency)")
    parser.add_argument("--env", choices=["live", "demo", "backtest"], help="default: from the MT5 account type")
    parser.add_argument("--lookback", type=int, default=90, help="days before DATE to search for opening deals (default 90)")
    parser.add_argument("--dry-run", action="store_true", help="print the CLI commands without writing")
    args = parser.parse_args()
    try:
        target = date.fromisoformat(args.date)
    except ValueError:
        sys.exit("date must be YYYY-MM-DD")

    account = api("/account")
    days = (date.today() - target).days + args.lookback + 1
    env = args.env or ("live" if account.get("trade_mode") == 2 else "demo")
    trades, skipped = build(target.isoformat(), api(f"/history/deals?days={days}"), api(f"/history/orders?days={days}"), api("/positions"), env)

    binary = cli_bin()
    cc_account = args.account or pick_account(binary, account["currency"])
    print(f"{len(trades)} position(s) on {target} for MT5 {account['login']} ({account['currency']}, {env}) -> CandleCraft account {cc_account}")
    for p in skipped:
        print(f"skipped mt5:{p}: opening deal is older than --lookback {args.lookback}", file=sys.stderr)
    for t in trades:
        cmd = [binary, "add", "--account", cc_account] + [x for k, v in t.items() for x in (f"--{k}", str(v))]
        if args.dry_run:
            print(shlex.join(cmd))
            continue
        result = subprocess.run(cmd, capture_output=True, text=True)
        print(result.stdout.strip() or result.stderr.strip())
        if result.returncode:
            sys.exit(result.returncode)


def self_test():
    def deal(pos, entry, type_, t, price, vol=1.0, profit=0.0, comm=-3.5, reason=0, order=0):
        return {"position_id": pos, "entry": entry, "type": type_, "time": t, "time_msc": t * 1000, "price": price,
                "volume": vol, "profit": profit, "commission": comm, "swap": 0.0, "fee": 0.0, "reason": reason,
                "symbol": "XAUUSD.r", "order": order}
    d1, d2 = 1_761_609_600, 1_761_696_000  # 2025-10-28, 2025-10-29 00:00 server time
    deals = [
        {"position_id": 0, "type": 2, "entry": 0, "time": d1, "time_msc": d1 * 1000},  # balance deal, ignored
        deal(1, IN, BUY, d1 + 60, 2000.0, order=11),
        deal(1, OUT, SELL, d1 + 120, 2010.0, 0.5, 5.0, reason=5),
        deal(1, OUT, SELL, d2 + 60, 2020.0, 0.5, 10.0, reason=4),
        deal(2, IN, SELL, d2 + 300, 1.1, 0.2),
        deal(3, IN, BUY, d1 - 86_400, 1.0),  # not on either day
    ]
    orders = [{"ticket": 11, "sl": 1990.0, "tp": 0.0}]
    trades, _ = build("2025-10-29", deals, orders, [{"ticket": 2, "identifier": 2}], "demo")
    closed, open_ = trades
    assert closed == {"symbol": "XAUUSD", "direction": "long", "env": "demo", "status": "closed", "entered": "2025-10-28",
                      "exited": "2025-10-29", "entry": 2000.0, "size": 1.0, "stop": 1990.0, "fees": -10.5, "ref": "mt5:1",
                      "exit": 2015.0, "gross": 15.0, "swap": 0.0, "exit-reason": "trailing"}, closed
    assert open_["status"] == "open" and open_["direction"] == "short" and "gross" not in open_ and open_["exited"] == "2025-10-29"
    assert [t["ref"] for t in build("2025-10-28", deals, orders, [{"ticket": 2}], "demo")[0]] == ["mt5:1"]
    no_levels, _ = build("2025-10-29", deals, [], [{"ticket": 2, "identifier": 2}], "demo")
    assert no_levels[0]["stop"] == 2020.0 and "target" not in no_levels[0]  # stop taken from the SL exit
    print("ok")


if __name__ == "__main__":
    self_test() if sys.argv[1:] == ["--self-test"] else main()
