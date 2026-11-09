// Command-line trade entry. Writes through the same validation and backups as the desktop app.
use serde_json::{json, Map, Value};
use std::{collections::HashMap, env, path::PathBuf, process, time::{SystemTime, UNIX_EPOCH}};
use tlog_lib::{load_document, save_document};

const USAGE: &str = "Usage:
  candlecraft accounts
  candlecraft strategies
  candlecraft add --symbol EURUSD --direction long|short [options]

Options for add:
  --account <id|name>     default: first account
  --env live|demo|backtest            default: demo
  --status draft|planned|open|closed|cancelled   default: closed
  --entered YYYY-MM-DD    default: today (UTC)
  --exited YYYY-MM-DD     default: entered date
  --entry --exit --size --stop --target <number>
  --risk <number>         initial risk in account currency
  --gross <number>        gross profit/loss
  --fees --swap --spread <number>   signed costs, default 0
  --balance <number>      balance before entry
  --value-per-unit <number>
  --strategy <id|name>    links the latest version
  --setup <tag>
  --adherence yes|no|unassessed
  --exit-reason target|stop|manual|trailing|other
  --ref <external id>     re-adding the same ref on the same account updates that
                          trade, keeping journal notes and fields not passed again

Set CANDLECRAFT_DATA_DIR to use a different data directory.
Close the desktop app first: it saves its in-memory copy and would overwrite CLI entries.";

fn fail(message: impl std::fmt::Display) -> ! {
    eprintln!("error: {message}");
    process::exit(1)
}

fn data_dir() -> PathBuf {
    if let Some(dir) = env::var_os("CANDLECRAFT_DATA_DIR") { return dir.into(); }
    let home = || PathBuf::from(env::var_os("HOME").unwrap_or_else(|| fail("HOME is not set")));
    let base = if cfg!(target_os = "macos") {
        home().join("Library/Application Support")
    } else if cfg!(windows) {
        PathBuf::from(env::var_os("APPDATA").unwrap_or_else(|| fail("APPDATA is not set")))
    } else {
        env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".local/share"))
    };
    base.join("app.margin.trading")
}

// Days since 1970-01-01 to (year, month, day), Howard Hinnant's civil_from_days.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

fn now() -> (String, String, u128) {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let secs = elapsed.as_secs() as i64;
    let (y, m, d) = civil(secs.div_euclid(86_400));
    let t = secs.rem_euclid(86_400);
    let date = format!("{y:04}-{m:02}-{d:02}");
    let stamp = format!("{date}T{:02}:{:02}:{:02}.{:03}Z", t / 3600, t / 60 % 60, t % 60, elapsed.subsec_millis());
    (date, stamp, elapsed.as_nanos())
}

fn is_date(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn parse_flags(args: &[String]) -> HashMap<String, String> {
    let mut flags = HashMap::new();
    let mut iter = args.iter();
    while let Some(key) = iter.next() {
        let name = key.strip_prefix("--").unwrap_or_else(|| fail(format!("unexpected argument '{key}'")));
        let value = iter.next().unwrap_or_else(|| fail(format!("--{name} needs a value")));
        flags.insert(name.to_string(), value.clone());
    }
    flags
}

fn choice<'a>(flags: &'a HashMap<String, String>, key: &str, allowed: &[&str], default: &'a str) -> &'a str {
    let value = flags.get(key).map(String::as_str).unwrap_or(default);
    if !allowed.contains(&value) { fail(format!("--{key} must be one of: {}", allowed.join(", "))) }
    value
}

fn number(flags: &HashMap<String, String>, key: &str) -> Option<f64> {
    flags.get(key).map(|text| text.parse::<f64>().ok().filter(|n| n.is_finite()).unwrap_or_else(|| fail(format!("--{key} must be a number"))))
}

fn positive(flags: &HashMap<String, String>, key: &str) -> Value {
    match number(flags, key) {
        Some(n) if n <= 0.0 => fail(format!("--{key} must be greater than 0")),
        n => json!(n),
    }
}

// Finds a record by exact id, then by case-insensitive name.
fn find<'a>(items: &'a [Value], wanted: &str) -> Option<&'a Value> {
    items.iter().find(|item| item["id"] == wanted)
        .or_else(|| items.iter().find(|item| item["name"].as_str().is_some_and(|name| name.eq_ignore_ascii_case(wanted))))
}

fn build_trade(workspace: &Value, flags: &HashMap<String, String>) -> Value {
    const KNOWN: &[&str] = &["symbol", "direction", "account", "env", "status", "entered", "exited", "entry", "exit", "size", "stop", "target", "risk", "gross", "fees", "swap", "spread", "balance", "value-per-unit", "strategy", "setup", "adherence", "exit-reason", "ref"];
    if let Some(unknown) = flags.keys().find(|key| !KNOWN.contains(&key.as_str())) { fail(format!("unknown option --{unknown}")) }

    let symbol = flags.get("symbol").map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty()).unwrap_or_else(|| fail("--symbol is required"));
    if !flags.contains_key("direction") { fail("--direction is required") }
    let direction = choice(flags, "direction", &["long", "short"], "");

    let accounts = workspace["accounts"].as_array().unwrap();
    let account = match flags.get("account") {
        Some(wanted) => find(accounts, wanted).unwrap_or_else(|| fail(format!("no account '{wanted}' (see: candlecraft accounts)"))),
        None => accounts.first().unwrap_or_else(|| fail("workspace has no accounts")),
    };

    let (strategy_id, strategy_version) = match flags.get("strategy") {
        Some(wanted) => {
            let strategy = find(workspace["strategies"].as_array().unwrap(), wanted).unwrap_or_else(|| fail(format!("no strategy '{wanted}' (see: candlecraft strategies)")));
            let latest = strategy["versions"].as_array().unwrap().iter().filter_map(|v| v["number"].as_u64()).max();
            (strategy["id"].clone(), json!(latest))
        }
        None => (json!(""), Value::Null),
    };

    let (today, stamp, nanos) = now();
    let entered = flags.get("entered").cloned().unwrap_or(today);
    let exited = flags.get("exited").cloned().unwrap_or_else(|| entered.clone());
    if !is_date(&entered) || !is_date(&exited) { fail("dates must be YYYY-MM-DD") }
    if exited < entered { fail("--exited is before --entered") }

    json!({
        "id": format!("cli-{nanos:x}-{:x}", process::id()),
        "accountId": account["id"],
        "environment": choice(flags, "env", &["live", "demo", "backtest"], "demo"),
        "status": choice(flags, "status", &["draft", "planned", "open", "closed", "cancelled"], "closed"),
        "symbol": symbol,
        "direction": direction,
        "strategyId": strategy_id,
        "strategyVersion": strategy_version,
        "enteredAt": entered,
        "exitedAt": exited,
        "entryPrice": number(flags, "entry"),
        "exitPrice": number(flags, "exit"),
        "size": number(flags, "size"),
        "initialStop": number(flags, "stop"),
        "target": number(flags, "target"),
        "initialRisk": number(flags, "risk"),
        "gross": number(flags, "gross"),
        "fees": number(flags, "fees").unwrap_or(0.0),
        "swap": number(flags, "swap").unwrap_or(0.0),
        "spread": number(flags, "spread").unwrap_or(0.0),
        "balanceBefore": positive(flags, "balance"),
        "valuePerPriceUnit": positive(flags, "value-per-unit"),
        "setupTag": flags.get("setup").cloned().unwrap_or_default(),
        "ruleAdherence": choice(flags, "adherence", &["yes", "no", "unassessed"], "unassessed"),
        "exitReason": choice(flags, "exit-reason", &["", "target", "stop", "manual", "trailing", "other"], ""),
        "externalRef": flags.get("ref").cloned().unwrap_or_default(),
        "source": "manual",
        "reason": "", "notes": "", "lesson": "", "tags": [], "checklist": Map::new(),
        "createdAt": stamp, "updatedAt": stamp,
    })
}

// Re-adding a trade with the same --ref and account updates it in place: journal fields,
// id and createdAt are kept, as is any optional field whose flag was not passed this time.
fn upsert(old: &Value, mut trade: Value, flags: &HashMap<String, String>) -> Value {
    const KEEP: &[&str] = &["id", "createdAt", "reason", "notes", "lesson", "tags", "checklist", "evidence", "mt5"];
    const OPTIONAL: &[(&str, &[&str])] = &[("entry", &["entryPrice"]), ("exit", &["exitPrice"]), ("size", &["size"]), ("stop", &["initialStop"]), ("target", &["target"]), ("risk", &["initialRisk"]), ("gross", &["gross"]), ("fees", &["fees"]), ("swap", &["swap"]), ("spread", &["spread"]), ("balance", &["balanceBefore"]), ("value-per-unit", &["valuePerPriceUnit"]), ("strategy", &["strategyId", "strategyVersion"]), ("setup", &["setupTag"]), ("adherence", &["ruleAdherence"]), ("exit-reason", &["exitReason"])];
    let kept = OPTIONAL.iter().filter(|(flag, _)| !flags.contains_key(*flag)).flat_map(|(_, keys)| keys.iter());
    for key in KEEP.iter().chain(kept) {
        match old.get(*key) {
            Some(value) => trade[*key] = value.clone(),
            None => { trade.as_object_mut().unwrap().remove(*key); }
        }
    }
    trade
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let Some(command) = args.first() else { println!("{USAGE}"); return };
    if matches!(command.as_str(), "-h" | "--help" | "help") { println!("{USAGE}"); return }

    let dir = data_dir();
    let loaded = load_document(&dir).unwrap_or_else(|e| fail(e));
    if loaded.recovered_from_backup { eprintln!("note: workspace was damaged and restored from a local backup") }
    let mut workspace = loaded.data.unwrap_or_else(|| fail(format!("no workspace in {} (open CandleCraft once first)", dir.display())));

    match command.as_str() {
        "accounts" => for a in workspace["accounts"].as_array().unwrap() {
            println!("{}\t{}\t{}", a["id"].as_str().unwrap_or(""), a["currency"].as_str().unwrap_or(""), a["name"].as_str().unwrap_or(""));
        },
        "strategies" => for s in workspace["strategies"].as_array().unwrap() {
            let archived = if s["archived"] == true { "\t(archived)" } else { "" };
            println!("{}\t{}{archived}", s["id"].as_str().unwrap_or(""), s["name"].as_str().unwrap_or(""));
        },
        "add" => {
            let flags = parse_flags(&args[1..]);
            let trade = build_trade(&workspace, &flags);
            let summary = format!("{} {} {} {} {}", trade["symbol"].as_str().unwrap(), trade["direction"].as_str().unwrap(), trade["status"].as_str().unwrap(), trade["enteredAt"].as_str().unwrap(), trade["externalRef"].as_str().unwrap());
            let trades = workspace["trades"].as_array_mut().unwrap();
            let existing = trades.iter_mut().find(|t| trade["externalRef"] != "" && t["externalRef"] == trade["externalRef"] && t["accountId"] == trade["accountId"]);
            let action = match existing {
                Some(old) => { *old = upsert(old, trade, &flags); "updated" }
                None => { trades.push(trade); "added" }
            };
            save_document(&dir.join("workspace.db"), &workspace).unwrap_or_else(|e| fail(e));
            println!("{action} {summary}");
        }
        other => fail(format!("unknown command '{other}'\n\n{USAGE}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_754), (2026, 10, 28));
        assert_eq!(civil(11_016), (2000, 2, 29));
    }

    #[test]
    fn builds_valid_trade() {
        let workspace = json!({"accounts":[{"id":"a1","name":"AUD account","currency":"AUD"}],"strategies":[{"id":"s1","name":"Breakout","versions":[{"number":1,"checklist":[]},{"number":3,"checklist":[]}]}]});
        let flags = parse_flags(&["--symbol", "eurusd", "--direction", "short", "--strategy", "breakout", "--gross", "-12.5", "--entered", "2026-01-02"].map(String::from));
        let trade = build_trade(&workspace, &flags);
        assert_eq!(trade["symbol"], "EURUSD");
        assert_eq!(trade["accountId"], "a1");
        assert_eq!(trade["strategyVersion"], 3);
        assert_eq!(trade["gross"], -12.5);
        assert_eq!(trade["exitedAt"], "2026-01-02");
        assert_eq!(trade["balanceBefore"], Value::Null);
    }

    #[test]
    fn upsert_keeps_journal_and_unpassed_fields() {
        let workspace = json!({"accounts":[{"id":"a1","name":"A","currency":"AUD"}],"strategies":[]});
        let first = build_trade(&workspace, &parse_flags(&["--symbol", "XAUUSD", "--direction", "long", "--status", "open", "--stop", "2400", "--ref", "mt5:1"].map(String::from)));
        let mut old = first.clone();
        old["notes"] = json!("held through news");
        old["setupTag"] = json!("Pullback");
        let flags = parse_flags(&["--symbol", "XAUUSD", "--direction", "long", "--status", "closed", "--gross", "40", "--ref", "mt5:1"].map(String::from));
        let merged = upsert(&old, build_trade(&workspace, &flags), &flags);
        assert_eq!(merged["id"], first["id"]);
        assert_eq!(merged["notes"], "held through news");
        assert_eq!(merged["setupTag"], "Pullback");
        assert_eq!(merged["initialStop"], 2400.0);
        assert_eq!(merged["status"], "closed");
        assert_eq!(merged["gross"], 40.0);
    }
}
