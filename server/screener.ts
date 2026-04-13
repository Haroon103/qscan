// eslint-disable-next-line @typescript-eslint/no-var-requires
const _yfMod = require("yahoo-finance2");
const _YFC = _yfMod.default ?? _yfMod;
const yahooFinance = typeof _YFC === 'function' ? new _YFC({ suppressNotices: ['yahooSurvey'] }) : _YFC;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");

export interface StockData {
  ticker: string;
  companyName: string;
  exchange: string;
  sector?: string;
  marketCap?: number;
  price: number;
  priceChange1d?: number;
  volume?: number;
  avgVolume20d?: number;
  float?: number;
  adrPct?: number;
  rs1m?: number;
  rs3m?: number;
  rs6m?: number;
  rsRank?: number;
  ema10?: number;
  ema20?: number;
  nearEma?: boolean;
  pattern?: string;
  epGapPct?: number;
}

// Load full NASDAQ common-stock universe from bundled file (2,800+ tickers)
function loadUniverse(): string[] {
  try {
    const filePath = path.join(__dirname, "nasdaq_tickers.txt");
    const content = fs.readFileSync(filePath, "utf-8");
    const tickers = content.split("\n").map((t: string) => t.trim()).filter(Boolean);
    console.log(`[screener] Loaded ${tickers.length} NASDAQ tickers from universe file`);
    return tickers;
  } catch (err) {
    console.warn("[screener] Could not load nasdaq_tickers.txt, falling back to minimal universe", err);
    return ["AAPL","MSFT","AMZN","NVDA","TSLA","MARA","RIOT","IONQ","RGTI","ASTS",
            "RKLB","LUNR","ACHR","RXRX","HIMS","CORZ","KULR","QBTS","SPIR","SMCI"];
  }
}

const UNIVERSE = loadUniverse();

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] ?? 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateADR(highs: number[], lows: number[], period = 20): number {
  const n = Math.min(period, highs.length, lows.length);
  let totalAdr = 0;
  for (let i = highs.length - n; i < highs.length; i++) {
    if (lows[i] > 0) {
      totalAdr += ((highs[i] - lows[i]) / lows[i]) * 100;
    }
  }
  return n > 0 ? totalAdr / n : 0;
}

function detectPattern(
  closes: number[],
  volumes: number[],
  ema10: number,
  ema20: number,
  price: number,
  priceChange1d: number
): { pattern: string | null; epGapPct: number | null } {
  if (closes.length < 20) return { pattern: null, epGapPct: null };

  const recent = closes.slice(-20);
  const recentVol = volumes.slice(-20);
  const avgVol = recentVol.slice(0, 15).reduce((a, b) => a + b, 0) / 15;
  const todayVol = recentVol[recentVol.length - 1];

  // Episodic Pivot: gap up >10% on massive volume
  if (priceChange1d >= 10 && todayVol > avgVol * 2.5) {
    return { pattern: "ep", epGapPct: priceChange1d };
  }
  if (priceChange1d >= 7 && todayVol > avgVol * 3) {
    return { pattern: "ep", epGapPct: priceChange1d };
  }

  // High Tight Flag: stock up >100% in 4-8 weeks, now in tight consolidation near 10/20 EMA
  const lookback = Math.min(40, recent.length);
  const windowStart = recent[recent.length - lookback] ?? recent[0];
  const peakInWindow = Math.max(...recent);
  const moveFromBase = windowStart > 0 ? ((peakInWindow - windowStart) / windowStart) * 100 : 0;
  const recentTightness = Math.max(...recent.slice(-5)) / Math.min(...recent.slice(-5)) - 1;

  if (moveFromBase >= 80 && recentTightness < 0.08 && price <= ema10 * 1.05) {
    return { pattern: "htf", epGapPct: null };
  }

  // Flag pattern: near EMA with tight consolidation after a big move
  const move20d = recent.length >= 20
    ? ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100
    : 0;
  const nearEMA = Math.abs(price - ema10) / ema10 < 0.04 || Math.abs(price - ema20) / ema20 < 0.04;

  if (move20d >= 15 && nearEMA && recentTightness < 0.1) {
    return { pattern: "flag", epGapPct: null };
  }

  // Base: stock pulling into EMAs with declining volume
  const volDecline = recentVol.slice(-5).reduce((a, b) => a + b, 0) / 5 < avgVol * 0.7;
  if (nearEMA && volDecline && move20d > 5) {
    return { pattern: "base", epGapPct: null };
  }

  return { pattern: null, epGapPct: null };
}

export async function fetchStockData(ticker: string): Promise<StockData | null> {
  try {
    const [quote, history] = await Promise.all([
      yahooFinance.quote(ticker) as Promise<any>,
      yahooFinance.chart(ticker, {
        period1: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
        period2: new Date(),
        interval: "1d",
      }) as Promise<any>,
    ]);

    if (!quote || !quote.regularMarketPrice) return null;

    const price = quote.regularMarketPrice;
    const marketCap = quote.marketCap ?? 0;

    // Filter: market cap under $10B, NASDAQ/NYSE
    if (marketCap > 10_000_000_000) return null;

    const closes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const volumes: number[] = [];

    const chartData = history?.quotes ?? [];
    for (const bar of chartData) {
      if (bar.close && bar.high && bar.low && bar.volume) {
        closes.push(bar.close);
        highs.push(bar.high);
        lows.push(bar.low);
        volumes.push(bar.volume);
      }
    }

    if (closes.length < 30) return null;

    const ema10 = calculateEMA(closes, 10);
    const ema20 = calculateEMA(closes, 20);
    const adrPct = calculateADR(highs, lows, 20);

    // Average volume 20d
    const avgVolume20d = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);

    // Relative strength vs reference (SPY) - calculated as % gain relative to market
    const n = closes.length;
    const rs1m = n >= 21 ? ((closes[n - 1] - closes[n - 21]) / closes[n - 21]) * 100 : 0;
    const rs3m = n >= 63 ? ((closes[n - 1] - closes[n - 63]) / closes[n - 63]) * 100 : 0;
    const rs6m = n >= 126 ? ((closes[n - 1] - closes[n - 126]) / closes[n - 126]) * 100 : 0;

    // Composite RS rank (weighted: 40% 3m, 30% 6m, 30% 1m)
    const rsRank = rs1m * 0.3 + rs3m * 0.4 + rs6m * 0.3;

    const nearEma =
      Math.abs(price - ema10) / ema10 < 0.05 ||
      Math.abs(price - ema20) / ema20 < 0.05;

    const priceChange1d = quote.regularMarketChangePercent ?? 0;
    const { pattern, epGapPct } = detectPattern(closes, volumes, ema10, ema20, price, priceChange1d);

    return {
      ticker,
      companyName: quote.shortName ?? quote.longName ?? ticker,
      exchange: quote.exchange ?? "NASDAQ",
      sector: quote.sector ?? undefined,
      marketCap,
      price,
      priceChange1d,
      volume: quote.regularMarketVolume ?? undefined,
      avgVolume20d,
      float: quote.floatShares ?? undefined,
      adrPct,
      rs1m,
      rs3m,
      rs6m,
      rsRank,
      ema10,
      ema20,
      nearEma,
      pattern: pattern ?? undefined,
      epGapPct: epGapPct ?? undefined,
    };
  } catch (err) {
    return null;
  }
}

export interface ScreenerFilters {
  minAdrPct: number;
  maxMarketCapB: number;
  minRsRank: number;
  nearEmaOnly: boolean;
  minVolume: number;
  patternFilter: string; // "all" | "htf" | "ep" | "flag" | "base"
}

export const DEFAULT_FILTERS: ScreenerFilters = {
  minAdrPct: 2,
  maxMarketCapB: 10,
  minRsRank: 0,
  nearEmaOnly: false,
  minVolume: 100000,
  patternFilter: "all",
};

// Phase 1: Quick quote pre-filter — only fetch price/volume/mktcap to narrow universe
async function quickQuote(ticker: string): Promise<{ ticker: string; marketCap: number; avgVol: number } | null> {
  try {
    const q = await (yahooFinance.quote(ticker) as Promise<any>);
    if (!q || !q.regularMarketPrice) return null;
    const marketCap = q.marketCap ?? 0;
    const avgVol = q.averageDailyVolume3Month ?? q.averageDailyVolume10Day ?? q.regularMarketVolume ?? 0;
    return { ticker, marketCap, avgVol };
  } catch {
    return null;
  }
}

export async function runScreener(
  filters: ScreenerFilters = DEFAULT_FILTERS,
  onProgress?: (done: number, total: number) => void
): Promise<StockData[]> {
  const allTickers = UNIVERSE;
  const results: StockData[] = [];

  console.log(`[screener] Phase 1: Pre-filtering ${allTickers.length} tickers by market cap & volume...`);

  // ── Phase 1: Quick pre-filter (batches of 20, 100ms gap) ──────────────────
  const MAX_MARKET_CAP = filters.maxMarketCapB * 1_000_000_000;
  const MIN_VOL_PREFILTER = Math.max(30_000, filters.minVolume * 0.5); // looser threshold for phase 1
  const phase1BatchSize = 20;
  const candidates: string[] = [];
  const phase1Total = allTickers.length;

  for (let i = 0; i < allTickers.length; i += phase1BatchSize) {
    const batch = allTickers.slice(i, i + phase1BatchSize);
    const fetched = await Promise.allSettled(batch.map(quickQuote));
    for (const r of fetched) {
      if (r.status === "fulfilled" && r.value) {
        const { ticker, marketCap, avgVol } = r.value;
        // Pass: mktcap under limit (0 = unknown, allow through), and volume threshold
        if ((marketCap === 0 || marketCap <= MAX_MARKET_CAP) && avgVol >= MIN_VOL_PREFILTER) {
          candidates.push(ticker);
        }
      }
    }
    // Report phase 1 progress (first 50% of progress bar)
    const phase1Done = Math.min(i + phase1BatchSize, phase1Total);
    onProgress?.(Math.round(phase1Done / 2), phase1Total);
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[screener] Phase 1 complete: ${candidates.length} candidates from ${allTickers.length} tickers`);

  // ── Phase 2: Full analysis on candidates only ─────────────────────────────
  const phase2BatchSize = 15;
  const phase2Total = candidates.length;

  for (let i = 0; i < candidates.length; i += phase2BatchSize) {
    const batch = candidates.slice(i, i + phase2BatchSize);
    const fetched = await Promise.allSettled(batch.map(fetchStockData));

    for (const result of fetched) {
      if (result.status === "fulfilled" && result.value) {
        const s = result.value;
        if (
          (s.adrPct ?? 0) >= filters.minAdrPct &&
          (s.marketCap ?? 0) <= MAX_MARKET_CAP &&
          (s.rsRank ?? 0) >= filters.minRsRank &&
          (s.avgVolume20d ?? 0) >= filters.minVolume &&
          (!filters.nearEmaOnly || s.nearEma) &&
          (filters.patternFilter === "all" || s.pattern === filters.patternFilter)
        ) {
          results.push(s);
        }
      }
    }

    // Report phase 2 progress (second 50% of progress bar)
    const phase2Done = Math.min(i + phase2BatchSize, phase2Total);
    onProgress?.(
      Math.round(phase1Total / 2) + Math.round((phase2Done / phase2Total) * (phase1Total / 2)),
      phase1Total
    );
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`[screener] Phase 2 complete: ${results.length} stocks passed all filters`);

  // Sort by RS rank descending (top performers first)
  return results.sort((a, b) => (b.rsRank ?? 0) - (a.rsRank ?? 0));
}
