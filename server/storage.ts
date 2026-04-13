import { db } from "./db";
import { scanResults, watchlist, alerts, scanConfig } from "@shared/schema";
import type { InsertScanResult, ScanResult, InsertWatchlistItem, WatchlistItem, InsertAlert, Alert } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // Scan results
  getScanResults(): ScanResult[];
  upsertScanResults(results: InsertScanResult[]): void;
  clearScanResults(): void;

  // Watchlist
  getWatchlist(): WatchlistItem[];
  addToWatchlist(item: InsertWatchlistItem): WatchlistItem;
  removeFromWatchlist(ticker: string): void;

  // Alerts
  getAlerts(includeAll?: boolean): Alert[];
  addAlert(alert: InsertAlert): Alert;
  dismissAlert(id: number): void;
  clearAlerts(): void;

  // Config
  getConfig(key: string): string | null;
  setConfig(key: string, value: string): void;
}

export class DatabaseStorage implements IStorage {
  getScanResults(): ScanResult[] {
    return db.select().from(scanResults).orderBy(desc(scanResults.rsRank)).all();
  }

  upsertScanResults(results: InsertScanResult[]): void {
    // Clear and reinsert for fresh scan
    db.delete(scanResults).run();
    for (const result of results) {
      db.insert(scanResults).values(result).run();
    }
  }

  clearScanResults(): void {
    db.delete(scanResults).run();
  }

  getWatchlist(): WatchlistItem[] {
    return db.select().from(watchlist).orderBy(desc(watchlist.addedAt)).all();
  }

  addToWatchlist(item: InsertWatchlistItem): WatchlistItem {
    return db.insert(watchlist).values(item).returning().get();
  }

  removeFromWatchlist(ticker: string): void {
    db.delete(watchlist).where(eq(watchlist.ticker, ticker)).run();
  }

  getAlerts(includeAll = false): Alert[] {
    if (includeAll) {
      return db.select().from(alerts).orderBy(desc(alerts.triggeredAt)).all();
    }
    return db.select().from(alerts)
      .where(eq(alerts.dismissed, 0))
      .orderBy(desc(alerts.triggeredAt))
      .all();
  }

  addAlert(alert: InsertAlert): Alert {
    return db.insert(alerts).values(alert).returning().get();
  }

  dismissAlert(id: number): void {
    db.update(alerts).set({ dismissed: 1 }).where(eq(alerts.id, id)).run();
  }

  clearAlerts(): void {
    db.delete(alerts).run();
  }

  getConfig(key: string): string | null {
    const row = db.select().from(scanConfig).where(eq(scanConfig.key, key)).get();
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    const existing = db.select().from(scanConfig).where(eq(scanConfig.key, key)).get();
    if (existing) {
      db.update(scanConfig).set({ value }).where(eq(scanConfig.key, key)).run();
    } else {
      db.insert(scanConfig).values({ key, value }).run();
    }
  }
}

export const storage = new DatabaseStorage();
