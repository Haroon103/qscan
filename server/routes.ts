import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runScreener, fetchStockData, DEFAULT_FILTERS, type ScreenerFilters } from "./screener";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const _yfMod2 = require("yahoo-finance2");
const _YFC2 = _yfMod2.default ?? _yfMod2;
const yahooFinance = typeof _YFC2 === 'function' ? new _YFC2({ suppressNotices: ['yahooSurvey'] }) : _YFC2;
import type { InsertScanResult } from "@shared/schema";

let scanInProgress = false;
let scanProgress = { done: 0, total: 0 };

export function registerRoutes(httpServer: Server, app: Express): void {
  // Get current scan results
  app.get("/api/scan-results", (_req, res) => {
    try {
      const results = storage.getScanResults();
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch results" });
    }
  });

  // Trigger a new scan
  app.post("/api/scan", async (req, res) => {
    if (scanInProgress) {
      return res.json({ status: "running", progress: scanProgress });
    }
    scanInProgress = true;
    scanProgress = { done: 0, total: 100 };
    res.json({ status: "started" });

    const filters: ScreenerFilters = {
      minAdrPct: Number(req.body.minAdrPct ?? DEFAULT_FILTERS.minAdrPct),
      maxMarketCapB: Number(req.body.maxMarketCapB ?? DEFAULT_FILTERS.maxMarketCapB),
      minRsRank: Number(req.body.minRsRank ?? DEFAULT_FILTERS.minRsRank),
      nearEmaOnly: req.body.nearEmaOnly === true || req.body.nearEmaOnly === "true",
      minVolume: Number(req.body.minVolume ?? DEFAULT_FILTERS.minVolume),
      patternFilter: req.body.patternFilter ?? DEFAULT_FILTERS.patternFilter,
    };

    try {
      const results = await runScreener(filters, (done, total) => {
        scanProgress = { done, total };
      });

      const now = new Date().toISOString();
      const toInsert: InsertScanResult[] = results.map((s) => ({
        ticker: s.ticker,
        companyName: s.companyName,
        exchange: s.exchange,
        sector: s.sector ?? null,
        marketCap: s.marketCap ?? null,
        price: s.price,
        priceChange1d: s.priceChange1d ?? null,
        volume: s.volume ?? null,
        avgVolume20d: s.avgVolume20d ?? null,
        float: s.float ?? null,
        adrPct: s.adrPct ?? null,
        rs1m: s.rs1m ?? null,
        rs3m: s.rs3m ?? null,
        rs6m: s.rs6m ?? null,
        rsRank: s.rsRank ?? null,
        ema10: s.ema10 ?? null,
        ema20: s.ema20 ?? null,
        nearEma: s.nearEma ? 1 : 0,
        pattern: s.pattern ?? null,
        epGapPct: s.epGapPct ?? null,
        scannedAt: now,
      }));

      storage.upsertScanResults(toInsert);

      // Generate alerts for notable setups
      for (const r of results) {
        if (r.pattern === "ep" && (r.epGapPct ?? 0) >= 10) {
          storage.addAlert({
            ticker: r.ticker,
            alertType: "ep",
            message: `${r.ticker} Episodic Pivot: +${r.epGapPct?.toFixed(1)}% gap on high volume`,
            price: r.price,
            triggeredAt: now,
          });
        }
        if (r.pattern === "htf") {
          storage.addAlert({
            ticker: r.ticker,
            alertType: "htf",
            message: `${r.ticker} High Tight Flag forming near 10/20 EMA`,
            price: r.price,
            triggeredAt: now,
          });
        }
        if (r.nearEma && r.pattern === "breakout") {
          storage.addAlert({
            ticker: r.ticker,
            alertType: "breakout",
            message: `${r.ticker} near breakout from consolidation`,
            price: r.price,
            triggeredAt: now,
          });
        }
      }
    } catch (err) {
      console.error("Scan error:", err);
    } finally {
      scanInProgress = false;
      scanProgress = { done: 100, total: 100 };
    }
  });

  // Scan progress
  app.get("/api/scan/progress", (_req, res) => {
    res.json({ inProgress: scanInProgress, ...scanProgress });
  });

  // Force reset scan lock (in case server got stuck)
  app.post("/api/scan/reset", (_req, res) => {
    scanInProgress = false;
    scanProgress = { done: 0, total: 0 };
    res.json({ ok: true, message: "Scan lock reset" });
  });

  // Stock chart data
  app.get("/api/chart/:ticker", async (req, res) => {
    try {
      const { ticker } = req.params;
      const days = Number(req.query.days ?? 120);
      const data: any = await yahooFinance.chart(ticker, {
        period1: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        period2: new Date(),
        interval: "1d",
      });
      const bars = (data?.quotes ?? [])
        .filter((b: any) => b.open && b.high && b.low && b.close && b.volume)
        .map((b: any) => ({
          time: Math.floor(new Date(b.date).getTime() / 1000),
          open: b.open!,
          high: b.high!,
          low: b.low!,
          close: b.close!,
          volume: b.volume!,
        }));
      res.json(bars);
    } catch (err) {
      res.status(500).json({ error: "Chart data unavailable" });
    }
  });

  // Quote for single ticker
  app.get("/api/quote/:ticker", async (req, res) => {
    try {
      const data = await fetchStockData(req.params.ticker.toUpperCase());
      if (!data) return res.status(404).json({ error: "Not found" });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: "Quote unavailable" });
    }
  });

  // Watchlist
  app.get("/api/watchlist", (_req, res) => {
    res.json(storage.getWatchlist());
  });

  app.post("/api/watchlist", (req, res) => {
    try {
      const { ticker, notes } = req.body;
      if (!ticker) return res.status(400).json({ error: "ticker required" });
      const item = storage.addToWatchlist({
        ticker: ticker.toUpperCase(),
        notes: notes ?? null,
        addedAt: new Date().toISOString(),
      });
      res.json(item);
    } catch (err: any) {
      if (err.message?.includes("UNIQUE")) {
        res.status(409).json({ error: "Already in watchlist" });
      } else {
        res.status(500).json({ error: "Failed to add" });
      }
    }
  });

  app.delete("/api/watchlist/:ticker", (req, res) => {
    storage.removeFromWatchlist(req.params.ticker.toUpperCase());
    res.json({ ok: true });
  });

  // Alerts
  app.get("/api/alerts", (_req, res) => {
    res.json(storage.getAlerts(false));
  });

  app.post("/api/alerts/:id/dismiss", (req, res) => {
    storage.dismissAlert(Number(req.params.id));
    res.json({ ok: true });
  });

  app.delete("/api/alerts", (_req, res) => {
    storage.clearAlerts();
    res.json({ ok: true });
  });

  // Market environment (QQQ 10/20 EMA check)
  app.get("/api/market-env", async (_req, res) => {
    try {
      const data: any = await yahooFinance.chart("QQQ", {
        period1: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        period2: new Date(),
        interval: "1d",
      });
      const closes = (data?.quotes ?? [])
        .filter((b: any) => b.close)
        .map((b: any) => b.close as number);

      const k10 = 2 / 11;
      const k20 = 2 / 21;
      let ema10 = closes[0];
      let ema20 = closes[0];
      for (const c of closes) {
        ema10 = c * k10 + ema10 * (1 - k10);
        ema20 = c * k20 + ema20 * (1 - k20);
      }

      const bullish = ema10 > ema20;
      res.json({
        bullish,
        ema10: Math.round(ema10 * 100) / 100,
        ema20: Math.round(ema20 * 100) / 100,
        qqq: closes[closes.length - 1],
        label: bullish ? "Green Light" : "Caution",
      });
    } catch (err) {
      res.json({ bullish: null, label: "Unknown", error: true });
    }
  });
}
