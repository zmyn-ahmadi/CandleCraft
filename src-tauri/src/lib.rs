use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceLoad {
    data: Option<Value>,
    recovered_from_backup: bool,
}

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("workspace.db"))
}

fn connection(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS workspace_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            schema_version INTEGER NOT NULL,
            revision INTEGER NOT NULL,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn validate_canvas_collections(value: &Value) -> bool {
    let Some(collections) = value.as_array() else { return false };
    if collections.len() > 100 { return false; }
    let bounded_text = |item: &Value, key: &str, max: usize| item.get(key).and_then(Value::as_str).is_some_and(|text| text.len() <= max);
    let number = |item: &Value, key: &str| item.get(key).and_then(Value::as_f64).filter(|number| number.is_finite());
    let coord = |item: &Value, key: &str| number(item, key).is_some();
    let color = |item: &Value| item.get("color").and_then(Value::as_str).is_some_and(|color| color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit()));
    let valid_item = |item: &Value| {
        if !bounded_text(item, "id", 100) { return false; }
        match item.get("kind").and_then(Value::as_str) {
            Some("stroke") => item.get("points").and_then(Value::as_array).is_some_and(|points| !points.is_empty() && points.len() <= 10_000 && points.iter().all(|point| coord(point, "x") && coord(point, "y")))
                && color(item)
                && number(item, "width").is_some_and(|width| width > 0.0 && width <= 40.0)
                && number(item, "opacity").is_some_and(|opacity| opacity > 0.0 && opacity <= 1.0),
            Some("shape") => item.get("shape").and_then(Value::as_str).is_some_and(|shape| ["line", "arrow", "rectangle"].contains(&shape))
                && coord(item, "x1") && coord(item, "y1") && coord(item, "x2") && coord(item, "y2")
                && color(item) && number(item, "width").is_some_and(|width| width > 0.0 && width <= 40.0),
            Some("note") | Some("image") | Some("text") => {
                let Some(_x) = number(item, "x") else { return false };
                let Some(_y) = number(item, "y") else { return false };
                let Some(width) = number(item, "width") else { return false };
                let Some(height) = number(item, "height") else { return false };
                if width < 180.0 || height < (if item["kind"] == "text" { 40.0 } else { 120.0 }) { return false; }
                if item["kind"] == "text" { return color(item) && bounded_text(item, "text", 50_000) && number(item, "fontSize").is_some_and(|size| (12.0..=96.0).contains(&size)); }
                if item["kind"] == "note" {
                    item.get("color").and_then(Value::as_str).is_some_and(|color| ["sand", "mint", "lilac", "slate"].contains(&color)) && bounded_text(item, "text", 50_000)
                } else {
                    let Some(source) = item.get("src").and_then(Value::as_str) else { return false };
                    let payload = ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,"].iter().find_map(|prefix| source.strip_prefix(prefix));
                    bounded_text(item, "name", 200) && source.len() <= 4_000_000 && payload.is_some_and(|payload| !payload.is_empty() && payload.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/' || byte == b'='))
                }
            },
            _ => false,
        }
    };
    collections.iter().all(|collection| bounded_text(collection, "id", 100) && bounded_text(collection, "name", 120) && bounded_text(collection, "createdAt", 40) && bounded_text(collection, "updatedAt", 40)
        && collection.get("boards").and_then(Value::as_array).is_some_and(|boards| boards.len() <= 200 && boards.iter().all(|board| bounded_text(board, "id", 100) && bounded_text(board, "title", 120) && bounded_text(board, "createdAt", 40) && bounded_text(board, "updatedAt", 40)
            && board.get("background").and_then(Value::as_str).is_some_and(|background| ["paper", "graphite", "blueprint"].contains(&background))
            && board.get("items").and_then(Value::as_array).is_some_and(|items| items.len() <= 10_000 && items.iter().all(&valid_item)))))
}

fn validate_workspace(data: &Value) -> Result<(), String> {
    if data.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !["accounts", "strategies", "trades", "reviews"]
            .iter()
            .all(|key| data.get(key).is_some_and(Value::is_array))
    {
        return Err("Invalid or unsupported workspace document".into());
    }
    let text = |item: &Value, key: &str| item.get(key).is_some_and(Value::is_string);
    let number_or_null = |item: &Value, key: &str| {
        item.get(key)
            .is_some_and(|value| value.is_null() || value.as_f64().is_some_and(f64::is_finite))
    };
    if !data["accounts"].as_array().unwrap().iter().all(|item| {
        text(item, "id")
            && text(item, "name")
            && item
                .get("currency")
                .and_then(Value::as_str)
                .is_some_and(|currency| {
                    currency.len() == 3 && currency.bytes().all(|byte| byte.is_ascii_uppercase())
                })
    }) {
        return Err("Workspace has invalid accounts".into());
    }
    if !data["strategies"].as_array().unwrap().iter().all(|item| {
        text(item, "id")
            && text(item, "name")
            && item
                .get("versions")
                .and_then(Value::as_array)
                .is_some_and(|versions| {
                    !versions.is_empty()
                        && versions.iter().all(|version| {
                            version.get("number").and_then(Value::as_u64).is_some()
                                && version.get("checklist").is_some_and(Value::is_array)
                        })
                })
    }) {
        return Err("Workspace has invalid strategies".into());
    }
    if !data["trades"].as_array().unwrap().iter().all(|item| {
        ["id", "accountId", "symbol", "enteredAt", "exitedAt"]
            .iter()
            .all(|key| text(item, key))
            && item
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|value| {
                    ["draft", "planned", "open", "closed", "cancelled"].contains(&value)
                })
            && item
                .get("environment")
                .and_then(Value::as_str)
                .is_some_and(|value| ["live", "demo", "backtest"].contains(&value))
            && item
                .get("direction")
                .and_then(Value::as_str)
                .is_some_and(|value| ["long", "short"].contains(&value))
            && number_or_null(item, "gross")
            && number_or_null(item, "initialRisk")
            && item
                .get("fees")
                .and_then(Value::as_f64)
                .is_some_and(f64::is_finite)
            && item
                .get("swap")
                .and_then(Value::as_f64)
                .is_some_and(f64::is_finite)
            && ["balanceBefore", "valuePerPriceUnit"].iter().all(|key| item.get(*key).is_none_or(|value| value.is_null() || value.as_f64().is_some_and(|number| number.is_finite() && number > 0.0)))
            && item.get("spread").is_none_or(|value| value.as_f64().is_some_and(f64::is_finite))
            && item.get("setupTag").is_none_or(Value::is_string)
            && item.get("ruleAdherence").is_none_or(|value| value.as_str().is_some_and(|text| ["yes", "no", "unassessed"].contains(&text)))
            && item.get("exitReason").is_none_or(|value| value.as_str().is_some_and(|text| ["", "target", "stop", "manual", "trailing", "other"].contains(&text)))
            && item.get("tags").is_some_and(Value::is_array)
            && item.get("checklist").is_some_and(Value::is_object)
    }) {
        return Err("Workspace has invalid trades".into());
    }
    if let Some(profiles) = data.get("riskProfiles") {
        let valid = profiles.as_object().is_some_and(|profiles| profiles.values().all(|profile| {
            profile.as_object().is_some()
                && profile.get("startingBalance").is_some_and(|value| value.is_null() || value.as_f64().is_some_and(|number| number.is_finite() && number > 0.0))
                && ["perTradePct", "minRewardRisk", "dailyLossPct", "weeklyDrawdownPct", "maxDrawdownPct", "reducedRiskPct", "cooldownHours"].iter().all(|key| profile.get(*key).and_then(Value::as_f64).is_some_and(|number| number.is_finite() && number > 0.0))
                && profile.get("lossStreakLimit").and_then(Value::as_u64).is_some_and(|number| number > 0)
                && profile.get("reviewedDrawdownAt").is_none_or(Value::is_string)
                && profile.get("drawdownReviewNote").is_none_or(Value::is_string)
        }));
        if !valid { return Err("Workspace has invalid risk profiles".into()); }
    }
    if let Some(note) = data.get("riskNotebook") {
        let positive_or_null = |key: &str| note.get(key).is_some_and(|value| value.is_null() || value.as_f64().is_some_and(|number| number.is_finite() && number > 0.0));
        let finite_or_null = |key: &str| note.get(key).is_some_and(|value| value.is_null() || value.as_f64().is_some_and(f64::is_finite));
        let valid = note.is_object()
            && ["balance", "entry", "stop", "target", "valuePerPriceUnit", "dailyStart", "weeklyPeak", "accountPeak"].iter().all(|key| positive_or_null(key))
            && finite_or_null("dailyPnl")
            && ["wins", "losses", "averageWin", "averageLoss", "grossProfit", "grossLoss", "followedPlan", "reviewedTrades"].iter().all(|key| note.get(*key).is_some_and(|value| value.is_null() || value.as_f64().is_some_and(|number| number.is_finite() && number >= 0.0)))
            && ["wins", "losses", "followedPlan", "reviewedTrades"].iter().all(|key| note.get(*key).is_some_and(|value| value.is_null() || value.as_u64().is_some()))
            && ["perTradePct", "minRewardRisk", "dailyLossPct", "weeklyDrawdownPct", "maxDrawdownPct", "reducedRiskPct", "cooldownHours"].iter().all(|key| note.get(*key).and_then(Value::as_f64).is_some_and(|number| number.is_finite() && number > 0.0))
            && note.get("lossStreakLimit").and_then(Value::as_u64).is_some_and(|number| number > 0)
            && note.get("consecutiveStopLosses").and_then(Value::as_u64).is_some()
            && note.get("estimatedFees").and_then(Value::as_f64).is_some_and(|number| number.is_finite() && number >= 0.0)
            && note.get("direction").and_then(Value::as_str).is_some_and(|value| ["long", "short"].contains(&value))
            && ["lastStopAt", "entryRules", "stopRules", "exitRules", "resetRules", "reviewNotes", "equityHistory"].iter().all(|key| text(note, key));
        if !valid { return Err("Workspace has invalid risk notebook".into()); }
    }
    if data.get("canvasCollections").is_some_and(|collections| !validate_canvas_collections(collections)) {
        return Err("Workspace has invalid canvas collections".into());
    }
    if !data["reviews"].as_array().unwrap().iter().all(|item| {
        ["id", "date", "from", "to"]
            .iter()
            .all(|key| text(item, key))
            && item.get("snapshot").is_some_and(|snapshot| {
                snapshot.get("trades").and_then(Value::as_u64).is_some()
                    && snapshot
                        .get("net")
                        .and_then(Value::as_f64)
                        .is_some_and(f64::is_finite)
                    && number_or_null(snapshot, "netR")
                    && number_or_null(snapshot, "adherence")
            })
    }) {
        return Err("Workspace has invalid reviews".into());
    }
    if let Some(replay) = data.get("replay") {
        let candles = replay
            .get("candles")
            .and_then(Value::as_array)
            .ok_or("Workspace has invalid replay data")?;
        let cursor = replay
            .get("cursor")
            .and_then(Value::as_u64)
            .ok_or("Workspace has invalid replay cursor")?;
        if candles.is_empty()
            || cursor as usize >= candles.len()
            || !candles.iter().all(|candle| {
                text(candle, "time")
                    && ["open", "high", "low", "close"].iter().all(|key| {
                        candle
                            .get(key)
                            .and_then(Value::as_f64)
                            .is_some_and(f64::is_finite)
                    })
            })
        {
            return Err("Workspace has invalid replay data".into());
        }
        if !candles.iter().all(|candle| {
            candle.get("volume").is_none_or(|volume| {
                volume.as_f64().is_some_and(|value| value.is_finite() && value >= 0.0)
            })
        }) {
            return Err("Workspace has invalid replay volume".into());
        }
        if replay.get("timeframe").is_some_and(|value| {
            !matches!(value.as_str(), Some("source" | "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1D" | "1W" | "1M"))
        }) {
            return Err("Workspace has invalid replay timeframe".into());
        }
        if let Some(drawings) = replay.get("drawings") {
            let drawings = drawings.as_array().ok_or("Workspace has invalid replay drawings")?;
            let valid_point = |point: &Value| {
                point.get("index").and_then(Value::as_u64).is_some_and(|index| index < candles.len() as u64)
                    && point.get("price").and_then(Value::as_f64).is_some_and(f64::is_finite)
            };
            if !drawings.iter().all(|drawing| {
                let kind = drawing.get("type").and_then(Value::as_str);
                drawing.get("id").and_then(Value::as_str).is_some()
                    && matches!(kind, Some("trend" | "ray" | "horizontal" | "vertical" | "rectangle" | "fib" | "measure"))
                    && drawing.get("a").is_some_and(&valid_point)
                    && (matches!(kind, Some("horizontal" | "vertical")) && drawing.get("b").is_none()
                        || !matches!(kind, Some("horizontal" | "vertical")) && drawing.get("b").is_some_and(&valid_point))
            }) {
                return Err("Workspace has invalid replay drawings".into());
            }
        }
    }
    Ok(())
}

fn parse_workspace(json: &str) -> Result<Value, String> {
    let data: Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    validate_workspace(&data)?;
    Ok(data)
}

fn read_primary(path: &Path) -> Result<Option<Value>, String> {
    let conn = connection(path)?;
    let json: Option<String> = conn
        .query_row("SELECT data FROM workspace_state WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    json.map(|value| parse_workspace(&value)).transpose()
}

fn backup_dir(dir: &Path) -> PathBuf {
    dir.join("backups")
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Backup has no parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temp = parent.join(format!(".workspace-{suffix}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn write_backups(dir: &Path, json: &str) -> Result<(), String> {
    let backups = backup_dir(dir);
    fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        / 86_400;
    let daily = backups.join(format!("day-{days}.json"));
    if !daily.exists() {
        atomic_write(&daily, json.as_bytes())?;
    }
    atomic_write(&backups.join("latest.json"), json.as_bytes())
}

fn read_backup(dir: &Path) -> Result<Option<Value>, String> {
    let backups = backup_dir(dir);
    if !backups.exists() {
        return Ok(None);
    }
    let mut paths = vec![backups.join("latest.json")];
    let mut daily: Vec<PathBuf> = fs::read_dir(&backups)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("day-") && name.ends_with(".json"))
        })
        .collect();
    daily.sort();
    paths.extend(daily.into_iter().rev());
    for path in paths {
        if let Ok(json) = fs::read_to_string(&path) {
            if let Ok(data) = parse_workspace(&json) {
                return Ok(Some(data));
            }
        }
    }
    Ok(None)
}

fn save_document(path: &Path, data: &Value) -> Result<(), String> {
    validate_workspace(data)?;
    let json = serde_json::to_string(data).map_err(|e| e.to_string())?;
    let mut conn = connection(path)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO workspace_state (id, schema_version, revision, data) VALUES (1, 1, 1, ?1)
         ON CONFLICT(id) DO UPDATE SET data=excluded.data,
         revision=workspace_state.revision+1, updated_at=CURRENT_TIMESTAMP",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        write_backups(dir, &json)?;
    }
    Ok(())
}

fn archive_damaged_database(path: &Path) -> Result<(), String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    for suffix in ["", "-wal", "-shm"] {
        let source = PathBuf::from(format!("{}{}", path.display(), suffix));
        if source.exists() {
            let archived = PathBuf::from(format!("{}{}.damaged-{stamp}", path.display(), suffix));
            fs::rename(&source, &archived).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn load_document(dir: &Path) -> Result<WorkspaceLoad, String> {
    let path = dir.join("workspace.db");
    let primary = read_primary(&path);
    if let Ok(Some(ref data)) = primary {
        return Ok(WorkspaceLoad {
            data: Some(data.clone()),
            recovered_from_backup: false,
        });
    }
    if let Some(data) = read_backup(&dir)? {
        if primary.is_err() {
            archive_damaged_database(&path)?;
        }
        save_document(&path, &data)?;
        return Ok(WorkspaceLoad {
            data: Some(data),
            recovered_from_backup: true,
        });
    }
    match primary {
        Ok(None) => Ok(WorkspaceLoad {
            data: None,
            recovered_from_backup: false,
        }),
        Err(error) => Err(format!(
            "Workspace could not be loaded or recovered: {error}"
        )),
        Ok(Some(_)) => unreachable!(),
    }
}

#[tauri::command]
fn load_workspace(app: tauri::AppHandle) -> Result<WorkspaceLoad, String> {
    load_document(&app_dir(&app)?)
}

#[tauri::command]
fn save_workspace(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    save_document(&db_path(&app)?, &data)
}

#[tauri::command]
fn workspace_location(app: tauri::AppHandle) -> Result<String, String> {
    Ok(db_path(&app)?.display().to_string())
}

#[tauri::command]
fn workspace_backup_location(app: tauri::AppHandle) -> Result<String, String> {
    Ok(backup_dir(&app_dir(&app)?).display().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            save_workspace,
            workspace_location,
            workspace_backup_location
        ])
        .run(tauri::generate_context!())
        .expect("error while running CandleCraft");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_recovers_workspace() {
        let dir = std::env::temp_dir().join(format!(
            "margin-storage-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workspace.db");
        let original = serde_json::json!({"schemaVersion":1,"accounts":[],"strategies":[],"trades":[],"reviews":[]});
        save_document(&path, &original).unwrap();
        assert_eq!(read_primary(&path).unwrap(), Some(original.clone()));
        assert_eq!(read_backup(&dir).unwrap(), Some(original.clone()));

        let conn = connection(&path).unwrap();
        conn.execute(
            "UPDATE workspace_state SET data = 'corrupt' WHERE id = 1",
            [],
        )
        .unwrap();
        drop(conn);
        assert!(read_primary(&path).is_err());
        assert_eq!(read_backup(&dir).unwrap(), Some(original));
        fs::write(backup_dir(&dir).join("latest.json"), "corrupt").unwrap();
        assert_eq!(
            read_backup(&dir).unwrap(),
            Some(
                serde_json::json!({"schemaVersion":1,"accounts":[],"strategies":[],"trades":[],"reviews":[]})
            )
        );
        let recovered = load_document(&dir).unwrap();
        assert!(recovered.recovered_from_backup);
        assert_eq!(read_primary(&path).unwrap(), recovered.data);
        assert!(fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("workspace.db.damaged-")
            }));
    }

    #[test]
    fn rejects_incomplete_workspace() {
        assert!(validate_workspace(&serde_json::json!({"schemaVersion":1,"trades":[]})).is_err());
    }

    #[test]
    fn preserves_nested_records_and_rejects_bad_replacement() {
        let dir = std::env::temp_dir().join(format!(
            "margin-roundtrip-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("workspace.db");
        let workspace = serde_json::json!({
            "schemaVersion": 1,
            "accounts": [{"id":"primary","name":"AUD account","currency":"AUD"}],
            "strategies": [{"id":"strategy","name":"Plan","versions":[{"number":1,"checklist":[]}]}],
            "trades": [{"id":"trade","accountId":"primary","environment":"demo","status":"closed","symbol":"AUDUSD","direction":"long","enteredAt":"2025-01-01","exitedAt":"2025-01-02","gross":35.5,"fees":-1.5,"swap":0,"spread":-0.5,"initialRisk":20,"balanceBefore":1000,"valuePerPriceUnit":1,"setupTag":"Pullback","ruleAdherence":"yes","exitReason":"target","tags":[],"checklist":{},"evidence":{"before":"data:image/png;base64,YQ=="}}],
            "riskProfiles": {"demo:primary":{"startingBalance":1000,"perTradePct":1,"minRewardRisk":2,"dailyLossPct":2,"weeklyDrawdownPct":5,"maxDrawdownPct":10,"reducedRiskPct":0.5,"lossStreakLimit":3,"cooldownHours":24,"drawdownReviewNote":"Reduce exposure"}},
            "riskNotebook": {"balance":1000,"perTradePct":1,"minRewardRisk":2,"dailyLossPct":2,"weeklyDrawdownPct":5,"maxDrawdownPct":10,"reducedRiskPct":0.5,"lossStreakLimit":3,"cooldownHours":24,"direction":"long","entry":100,"stop":99,"target":102,"valuePerPriceUnit":1,"estimatedFees":0,"dailyStart":null,"dailyPnl":null,"weeklyPeak":null,"accountPeak":null,"consecutiveStopLosses":0,"lastStopAt":"","wins":null,"losses":null,"averageWin":null,"averageLoss":null,"grossProfit":null,"grossLoss":null,"followedPlan":null,"reviewedTrades":null,"entryRules":"Wait for retest","stopRules":"","exitRules":"","resetRules":"","reviewNotes":"","equityHistory":"1000, 980, 1020, 900"},
            "canvasCollections": [{"id":"collection","name":"Ideas","createdAt":"2025-01-01","updatedAt":"2025-01-01","boards":[{"id":"board","title":"Weekly map","background":"paper","createdAt":"2025-01-01","updatedAt":"2025-01-01","items":[{"id":"stroke","kind":"stroke","points":[{"x":10,"y":20},{"x":30,"y":40}],"color":"#293a42","width":3,"opacity":1},{"id":"note","kind":"note","x":100,"y":100,"width":300,"height":210,"color":"sand","text":"Wait for retest"},{"id":"image","kind":"image","x":450,"y":100,"width":300,"height":200,"name":"chart.png","src":"data:image/png;base64,YQ=="},{"id":"text","kind":"text","x":-5000,"y":8000,"width":340,"height":140,"color":"#293a42","fontSize":24,"text":"Market structure\nWait for a retest"}]}]}],
            "reviews": [{"id":"review","date":"2025-01-03","from":"2025-01-01","to":"2025-01-03","snapshot":{"trades":1,"net":34,"netR":1.7,"adherence":null}}],
            "replay": {"cursor":0,"timeframe":"1W","candles":[{"time":"2025-01-01T00:00:00Z","open":1.0,"high":1.1,"low":0.9,"close":1.05,"volume":1200}],"drawings":[{"id":"level","type":"horizontal","a":{"index":0,"price":1.05}}]}
        });
        save_document(&path, &workspace).unwrap();
        assert_eq!(read_primary(&path).unwrap(), Some(workspace.clone()));
        assert_eq!(read_backup(&dir).unwrap(), Some(workspace.clone()));
        let mut bad_timeframe = workspace.clone();
        bad_timeframe["replay"]["timeframe"] = serde_json::json!("30s");
        assert!(save_document(&path, &bad_timeframe).is_err());
        let mut bad_text = workspace.clone();
        bad_text["canvasCollections"][0]["boards"][0]["items"][3]["fontSize"] = serde_json::json!(0);
        assert!(save_document(&path, &bad_text).is_err());
        let mut bad_image = workspace.clone();
        bad_image["canvasCollections"][0]["boards"][0]["items"][2]["src"] = serde_json::json!("https://example.com/chart.png");
        assert!(save_document(&path, &bad_image).is_err());
        assert!(
            save_document(&path, &serde_json::json!({"schemaVersion":1,"accounts":[]})).is_err()
        );
        assert_eq!(read_primary(&path).unwrap(), Some(workspace));
    }
}
