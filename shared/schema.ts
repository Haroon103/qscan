import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Scan results table
export const scanResults = sqliteTable("scan_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  exchange: text("exchange").notNull(),
  sector: text("sector"),
  marketCap: real("market_cap"),
  price: real("price").notNull(),
  priceChange1d: real("price_change_1d"),
  volume: real("volume"),
  avgVolume20d: real("avg_volume_20d"),
  float: real("float"),
  adrPct: real("adr_pct"),       // Average Daily Range %
  rs1m: real("rs_1m"),           // Relative strength 1 month
  rs3m: real("rs_3m"),           // Relative strength 3 months
  rs6m: real("rs_6m"),           // Relative strength 6 months
  rsRank: real("rs_rank"),       // Composite RS rank percentile
  ema10: real("ema10"),
  ema20: real("ema20"),
  nearEma: integer("near_ema"),  // 1 if within 3% of 10/20 EMA
  pattern: text("pattern"),     // "htf" | "ep" | "flag" | "base" | null
  epGapPct: real("ep_gap_pct"), // Gap % if episodic pivot
  scannedAt: text("scanned_at").notNull(),
});

export const insertScanResultSchema = createInsertSchema(scanResults).omit({ id: true });
export type InsertScanResult = z.infer<typeof insertScanResultSchema>;
export type ScanResult = typeof scanResults.$inferSelect;

// Watchlist table
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull().unique(),
  notes: text("notes"),
  addedAt: text("added_at").notNull(),
});

export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true });
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;
export type WatchlistItem = typeof watchlist.$inferSelect;

// Alerts table
export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  alertType: text("alert_type").notNull(), // "breakout" | "ep" | "ema_touch" | "htf"
  message: text("message").notNull(),
  price: real("price"),
  triggeredAt: text("triggered_at").notNull(),
  dismissed: integer("dismissed").default(0),
});

export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;

// Scan config / filter settings
export const scanConfig = sqliteTable("scan_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});
