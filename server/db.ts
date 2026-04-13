import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";
import path from "path";

const DB_PATH = path.join(process.cwd(), "qscan.db");
const sqlite = new BetterSqlite3(DB_PATH);

// Enable WAL mode for better performance
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA synchronous = NORMAL;");

export const db = drizzle(sqlite, { schema });

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS scan_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    company_name TEXT NOT NULL,
    exchange TEXT NOT NULL,
    sector TEXT,
    market_cap REAL,
    price REAL NOT NULL,
    price_change_1d REAL,
    volume REAL,
    avg_volume_20d REAL,
    float REAL,
    adr_pct REAL,
    rs_1m REAL,
    rs_3m REAL,
    rs_6m REAL,
    rs_rank REAL,
    ema10 REAL,
    ema20 REAL,
    near_ema INTEGER,
    pattern TEXT,
    ep_gap_pct REAL,
    scanned_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL UNIQUE,
    notes TEXT,
    added_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    message TEXT NOT NULL,
    price REAL,
    triggered_at TEXT NOT NULL,
    dismissed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS scan_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL
  );
`);
