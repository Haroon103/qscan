import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ScanResult } from "@shared/schema";

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketEnv {
  bullish: boolean | null;
  label: string;
}

interface ChartPanelProps {
  ticker: string;
  onClose: () => void;
}

// Simple canvas-based OHLC chart (no external library dependency issues)
function drawChart(canvas: HTMLCanvasElement, bars: Bar[], ema10s: number[], ema20s: number[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const PAD = { top: 16, right: 16, bottom: 30, left: 60 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  ctx.clearRect(0, 0, W, H);

  if (bars.length === 0) return;

  const prices = bars.flatMap(b => [b.high, b.low]);
  const minP = Math.min(...prices) * 0.995;
  const maxP = Math.max(...prices) * 1.005;
  const range = maxP - minP;

  const barW = Math.max(2, (chartW / bars.length) - 1);
  const spacing = chartW / bars.length;

  const toX = (i: number) => PAD.left + i * spacing + spacing / 2;
  const toY = (p: number) => PAD.top + chartH - ((p - minP) / range) * chartH;

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(W - PAD.right, y);
    ctx.stroke();
    const price = maxP - (range / 4) * i;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(price.toFixed(2), PAD.left - 4, y + 3);
  }

  // Candles
  bars.forEach((bar, i) => {
    const x = toX(i);
    const isUp = bar.close >= bar.open;
    const color = isUp ? "#10b981" : "#ef4444";

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, toY(bar.high));
    ctx.lineTo(x, toY(bar.low));
    ctx.stroke();

    // Body
    const bodyTop = toY(Math.max(bar.open, bar.close));
    const bodyBot = toY(Math.min(bar.open, bar.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);
    ctx.fillStyle = color;
    ctx.fillRect(x - barW / 2, bodyTop, barW, bodyH);
  });

  // EMA 10 (cyan)
  if (ema10s.length === bars.length) {
    ctx.strokeStyle = "#0ea5e9";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ema10s.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // EMA 20 (orange)
  if (ema20s.length === bars.length) {
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ema20s.forEach((v, i) => {
      const x = toX(i);
      const y = toY(v);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // X-axis labels
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  const labelEvery = Math.max(1, Math.floor(bars.length / 6));
  bars.forEach((bar, i) => {
    if (i % labelEvery === 0) {
      const d = new Date(bar.time * 1000);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      ctx.fillText(label, toX(i), H - 8);
    }
  });

  // Legend
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(PAD.left, 6, 16, 2);
  ctx.fillText("EMA10", PAD.left + 20, 10);
  ctx.fillStyle = "#f97316";
  ctx.fillRect(PAD.left + 70, 6, 16, 2);
  ctx.fillText("EMA20", PAD.left + 90, 10);
}

function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length < period) return prices.map(() => prices[0] ?? 0);
  const k = 2 / (period + 1);
  const emas: number[] = [];
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = 0; i < period; i++) emas.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    emas.push(ema);
  }
  return emas;
}

export default function ChartPanel({ ticker, onClose }: ChartPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [days, setDays] = useState(90);

  const { data: bars = [], isLoading } = useQuery<Bar[]>({
    queryKey: ["/api/chart", ticker, days],
    queryFn: async () => {
      const res = await fetch(`/api/chart/${ticker}?days=${days}`);
      return res.json();
    },
  });

  const { data: stockData } = useQuery({
    queryKey: ["/api/scan-results"],
    select: (data: ScanResult[]) => data.find(r => r.ticker === ticker),
  });

  useEffect(() => {
    if (!canvasRef.current || bars.length === 0) return;
    const canvas = canvasRef.current;
    const closes = bars.map(b => b.close);
    const ema10s = calculateEMA(closes, 10);
    const ema20s = calculateEMA(closes, 20);
    drawChart(canvas, bars, ema10s, ema20s);
  }, [bars]);

  const latest = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const change = latest && prev ? ((latest.close - prev.close) / prev.close) * 100 : 0;

  return (
    <div className="chart-panel" data-testid="chart-panel">
      <div className="chart-header">
        <div className="chart-title-row">
          <div>
            <span className="chart-ticker">{ticker}</span>
            {stockData?.companyName && <span className="chart-name">{stockData.companyName}</span>}
          </div>
          <div className="chart-price-row">
            {latest && (
              <>
                <span className="chart-price">${latest.close.toFixed(2)}</span>
                <span className={`chart-change ${change >= 0 ? "pos" : "neg"}`}>
                  {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                </span>
              </>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <div className="chart-stats">
          {[
            { label: "ADR%", val: stockData?.adrPct ? `${stockData.adrPct.toFixed(1)}%` : "—" },
            { label: "RS 1M", val: stockData?.rs1m != null ? `${stockData.rs1m.toFixed(1)}%` : "—" },
            { label: "RS 3M", val: stockData?.rs3m != null ? `${stockData.rs3m.toFixed(1)}%` : "—" },
            { label: "RS 6M", val: stockData?.rs6m != null ? `${stockData.rs6m.toFixed(1)}%` : "—" },
            { label: "Avg Vol", val: stockData?.avgVolume20d ? formatVol(stockData.avgVolume20d) : "—" },
            { label: "Float", val: stockData?.float ? formatMktCap(stockData.float) : "—" },
            { label: "Pattern", val: stockData?.pattern?.toUpperCase() ?? "—" },
          ].map(s => (
            <div key={s.label} className="chart-stat">
              <div className="cs-label">{s.label}</div>
              <div className="cs-val">{s.val}</div>
            </div>
          ))}
        </div>

        <div className="chart-timeframe">
          {[30, 60, 90, 180].map(d => (
            <button
              key={d}
              className={`tf-btn ${days === d ? "active" : ""}`}
              onClick={() => setDays(d)}
              data-testid={`button-tf-${d}`}
            >{d}D</button>
          ))}
        </div>
      </div>

      <div className="chart-body">
        {isLoading ? (
          <div className="chart-loading">Loading chart...</div>
        ) : (
          <canvas
            ref={canvasRef}
            width={900}
            height={360}
            className="chart-canvas"
            data-testid="canvas-chart"
          />
        )}
      </div>

      <button className="chart-close" onClick={onClose} data-testid="button-chart-close">✕ Close</button>
    </div>
  );
}

function formatVol(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function formatMktCap(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}
