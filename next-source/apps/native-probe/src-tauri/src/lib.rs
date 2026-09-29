use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use tauri::Manager;
static PROBE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize)]
struct ProbeResult { persisted_runs: i64, rollback_ok: bool }

fn probe(path: std::path::PathBuf) -> Result<ProbeResult, String> {
    let _guard = PROBE_LOCK.lock().map_err(|_| "PROBE_LOCK_FAILED")?;
    let mut conn = Connection::open(path).map_err(|_| "OPEN_FAILED")?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS probe_runs(id INTEGER PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS probe_outbox(id INTEGER PRIMARY KEY);")
        .map_err(|_| "SCHEMA_FAILED")?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|_| "BEGIN_FAILED")?;
    tx.execute("INSERT INTO probe_runs DEFAULT VALUES", []).map_err(|_| "WRITE_FAILED")?;
    let id = tx.last_insert_rowid();
    tx.execute("INSERT INTO probe_outbox(id) VALUES(?1)", [id]).map_err(|_| "OUTBOX_FAILED")?;
    tx.commit().map_err(|_| "COMMIT_FAILED")?;
    {
        let tx = conn.transaction().map_err(|_| "BEGIN_FAILED")?;
        tx.execute("INSERT INTO probe_runs DEFAULT VALUES", []).map_err(|_| "WRITE_FAILED")?;
        // Deliberately fail the paired outbox write, then drop without commit.
        if tx.execute("INSERT INTO probe_outbox(id) VALUES(?1)", [id]).is_ok() {
            return Err("FAULT_INJECTION_FAILED".into());
        }
    }
    let runs: i64 = conn.query_row("SELECT COUNT(*) FROM probe_runs", [], |r| r.get(0)).map_err(|_| "READ_FAILED")?;
    let outbox: i64 = conn.query_row("SELECT COUNT(*) FROM probe_outbox", [], |r| r.get(0)).map_err(|_| "READ_FAILED")?;
    Ok(ProbeResult { persisted_runs: runs, rollback_ok: runs == outbox })
}

#[tauri::command]
fn run_probe(app: tauri::AppHandle) -> Result<ProbeResult, String> {
    let directory = app.path().app_data_dir().map_err(|_| "PATH_FAILED")?;
    std::fs::create_dir_all(&directory).map_err(|_| "DIRECTORY_FAILED")?;
    probe(directory.join("native-probe.sqlite"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![run_probe])
        .run(tauri::generate_context!()).expect("NATIVE_PROBE_START_FAILED");
}
