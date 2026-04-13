import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, checkBackendAlive } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ScanResult, Alert, WatchlistItem } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import ChartPanel from "@/components/ChartPanel";

const PATTERN_LABELS: Record<string, { label: string; color: string }> = {
  ep: { label: "Episodic Pivot", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  htf: { label: "High Tight Flag", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  flag: { label: "Flag", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  base: { label: "Base", color: "bg-purple-500/20 text-purple-300 border-purple-500/30" },
};

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtM(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  return `$${n.toLocaleString()}`;
}

function fmtVol(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

function RSBar({ value }: { value: number | null | undefined }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = v >= 90 ? "#10b981" : v >= 70 ? "#3b82f6" : v >= 50 ? "#f59e0b" : "#6b7280";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono tabular-nums w-8 text-right" style={{ color }}>{Math.round(v)}</span>
    </div>
  );
}

interface FilterState {
  minAdrPct: number;
  maxMarketCapB: number;
  minRsRank: number;
  nearEmaOnly: boolean;
  minVolume: number;
  patternFilter: string;
}

const DEFAULT_FILTERS: FilterState = {
  minAdrPct: 2,
  maxMarketCapB: 10,
  minRsRank: 0,
  nearEmaOnly: false,
  minVolume: 100000,
  patternFilter: "all",
};

export default function Dashboard() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<keyof ScanResult>("rsRank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [backendAlive, setBackendAlive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check backend connectivity on mount and every 30s
  useEffect(() => {
    checkBackendAlive().then(setBackendAlive);
    const iv = setInterval(() => checkBackendAlive().then(setBackendAlive), 30000);
    return () => clearInterval(iv);
  }, []);

  const { data: results = [], isLoading: resultsLoading } = useQuery<ScanResult[]>({
    queryKey: ["/api/scan-results"],
    refetchInterval: 60000,
  });

  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
    refetchInterval: 15000,
  });

  const { data: marketEnv } = useQuery<{
    bullish: boolean | null;
    label: string;
    ema10?: number;
    ema20?: number;
    qqq?: number;
  }>({
    queryKey: ["/api/market-env"],
    refetchInterval: 300000,
  });

  const { data: progress } = useQuery<{ inProgress: boolean; done: number; total: number }>({
    queryKey: ["/api/scan/progress"],
    refetchInterval: 2000,
  });

  const scanMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/scan", filters),
    onSuccess: () => {
      toast({ title: "Scan started", description: "Scanning NASDAQ universe — results will appear as they come in..." });
      // Clear any existing poll
      if (pollRef.current) clearInterval(pollRef.current);
      // Poll every 2 seconds for up to 3 minutes
      let elapsed = 0;
      const id = setInterval(() => {
        elapsed += 2000;
        queryClient.invalidateQueries({ queryKey: ["/api/scan-results"] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/scan/progress"] });
        if (elapsed >= 180000) {
          clearInterval(id);
          pollRef.current = null;
        }
      }, 2000);
      pollRef.current = id;
    },
    onError: (err: any) => {
      toast({ title: "Scan failed", description: String(err?.message ?? err), variant: "destructive" });
    },
  });

  const watchlistMutation = useMutation({
    mutationFn: (ticker: string) => apiRequest("POST", "/api/watchlist", { ticker }),
    onSuccess: (_, ticker) => {
      toast({ title: `${ticker} added to watchlist` });
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
    },
    onError: () => toast({ title: "Already in watchlist", variant: "destructive" }),
  });

  const dismissAlertMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/alerts/${id}/dismiss`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  const handleSort = (key: keyof ScanResult) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = [...results].sort((a, b) => {
    const av = a[sortKey] as number ?? 0;
    const bv = b[sortKey] as number ?? 0;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const isScanning = progress?.inProgress ?? false;
  const scanPct = progress ? (progress.done / Math.max(1, progress.total)) * 100 : 0;
  const activeAlerts = alerts.filter(a => !a.dismissed).length;

  function SortIcon({ col }: { col: keyof ScanResult }) {
    if (sortKey !== col) return <span className="opacity-30">↕</span>;
    return <span>{sortDir === "desc" ? "↓" : "↑"}</span>;
  }

  const envColor = marketEnv?.bullish === true ? "text-emerald-400" : marketEnv?.bullish === false ? "text-red-400" : "text-zinc-400";

  return (
    <div className="dashboard">
      {/* SIDEBAR */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <svg aria-label="QScan" viewBox="0 0 40 40" fill="none" width="32" height="32">
            <rect x="4" y="4" width="32" height="32" rx="6" fill="#0ea5e9" opacity="0.15"/>
            <path d="M20 8 L32 20 L20 32 L8 20 Z" stroke="#0ea5e9" strokeWidth="2" fill="none"/>
            <circle cx="20" cy="20" r="4" fill="#0ea5e9"/>
            <path d="M28 28 L34 34" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span className="logo-text">QScan</span>
        </div>

        {/* Market Environment */}
        <div className="sidebar-section">
          <div className="section-label">Market Filter</div>
          <div className="market-env">
            <div className={`env-dot ${marketEnv?.bullish ? "bull" : "bear"}`} />
            <div>
              <div className={`env-label ${envColor}`}>{marketEnv?.label ?? "Loading..."}</div>
              {marketEnv?.qqq && (
                <div className="env-detail">QQQ {marketEnv.qqq.toFixed(2)} · EMA10 {marketEnv.ema10?.toFixed(2)} / EMA20 {marketEnv.ema20?.toFixed(2)}</div>
              )}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="sidebar-section">
          <div className="section-label">Screener Filters</div>

          <div className="filter-group">
            <Label className="filter-label">Min ADR% <span className="filter-val">{filters.minAdrPct}%</span></Label>
            <Slider min={0.5} max={15} step={0.5} value={[filters.minAdrPct]}
              onValueChange={([v]) => setFilters(f => ({ ...f, minAdrPct: v }))} />
          </div>

          <div className="filter-group">
            <Label className="filter-label">Max Market Cap <span className="filter-val">${filters.maxMarketCapB}B</span></Label>
            <Slider min={0.1} max={10} step={0.1} value={[filters.maxMarketCapB]}
              onValueChange={([v]) => setFilters(f => ({ ...f, maxMarketCapB: v }))} />
          </div>

          <div className="filter-group">
            <Label className="filter-label">Min RS Rank <span className="filter-val">{filters.minRsRank}</span></Label>
            <Slider min={-50} max={100} step={5} value={[filters.minRsRank]}
              onValueChange={([v]) => setFilters(f => ({ ...f, minRsRank: v }))} />
          </div>

          <div className="filter-group">
            <Label className="filter-label">Min Avg Volume <span className="filter-val">{fmtVol(filters.minVolume)}</span></Label>
            <Slider min={50000} max={2000000} step={50000} value={[filters.minVolume]}
              onValueChange={([v]) => setFilters(f => ({ ...f, minVolume: v }))} />
          </div>

          <div className="filter-group">
            <Label className="filter-label">Pattern</Label>
            <Select value={filters.patternFilter} onValueChange={v => setFilters(f => ({ ...f, patternFilter: v }))}>
              <SelectTrigger className="select-trigger" data-testid="select-pattern">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Patterns</SelectItem>
                <SelectItem value="ep">Episodic Pivot</SelectItem>
                <SelectItem value="htf">High Tight Flag</SelectItem>
                <SelectItem value="flag">Flag</SelectItem>
                <SelectItem value="base">Base</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="filter-row">
            <Label className="filter-label">Near 10/20 EMA only</Label>
            <Switch checked={filters.nearEmaOnly}
              onCheckedChange={v => setFilters(f => ({ ...f, nearEmaOnly: v }))}
              data-testid="switch-near-ema" />
          </div>

          <Button
            className="scan-btn"
            onClick={() => scanMutation.mutate()}
            disabled={isScanning}
            data-testid="button-scan"
          >
            {isScanning ? "Scanning..." : "Run Scan"}
          </Button>

          {isScanning && (
            <div className="scan-progress">
              <Progress value={scanPct} className="h-1" />
              <span className="progress-label">{progress?.done ?? 0} / {progress?.total ?? 0} tickers</span>
            </div>
          )}
        </div>

        {/* Stat summary */}
        <div className="sidebar-section">
          <div className="section-label">Results</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-val">{results.length}</div>
              <div className="stat-name">Stocks</div>
            </div>
            <div className="stat">
              <div className="stat-val ep">{results.filter(r => r.pattern === "ep").length}</div>
              <div className="stat-name">EP</div>
            </div>
            <div className="stat">
              <div className="stat-val htf">{results.filter(r => r.pattern === "htf").length}</div>
              <div className="stat-name">HTF</div>
            </div>
            <div className="stat">
              <div className="stat-val">{results.filter(r => r.nearEma).length}</div>
              <div className="stat-name">Near EMA</div>
            </div>
          </div>
        </div>

        <button className="alerts-btn" onClick={() => setAlertPanelOpen(true)} data-testid="button-alerts">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          Alerts
          {activeAlerts > 0 && <span className="alert-badge">{activeAlerts}</span>}
        </button>
      </aside>

      {/* HEADER */}
      <header className="header">
        <div className="header-left">
          <h1 className="page-title">Qullamaggie Scanner</h1>
          <span className="subtitle">NASDAQ Micro/Small Cap · Top RS · High ADR</span>
        </div>
        <div className="header-right">
          {backendAlive
            ? <span className="backend-status connected">● Backend Connected</span>
            : <span className="backend-status disconnected" title="Backend server is not reachable">● Backend Offline</span>
          }
          {results.length > 0 && (
            <span className="last-scan">
              Last scan: {new Date(results[0]?.scannedAt ?? "").toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      {/* MAIN */}
      <main className="main">
        {resultsLoading ? (
          <div className="skeleton-table">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full mb-2 rounded-md" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 48 48" fill="none" width="48" height="48" className="empty-icon">
              <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="2"/>
              <path d="M16 24 L24 16 L32 24 L24 32 Z" stroke="currentColor" strokeWidth="2" fill="none"/>
              <circle cx="24" cy="24" r="3" fill="currentColor"/>
            </svg>
            {isScanning ? (
              <>
                <h3>Scanning in progress...</h3>
                <p>Scanning {(progress?.total ?? 2851).toLocaleString()} NASDAQ tickers in two phases. This takes 5–10 minutes.</p>
                <div className="scan-progress-empty">
                  <Progress value={scanPct} className="h-2" />
                  <span className="progress-label">
                    {(progress?.done ?? 0) < Math.round((progress?.total ?? 2851) / 2)
                      ? `Phase 1: Pre-filtering — ${progress?.done ?? 0} / ${progress?.total ?? 2851}`
                      : `Phase 2: Deep analysis — ${progress?.done ?? 0} / ${progress?.total ?? 2851}`
                    }
                  </span>
                </div>
              </>
            ) : (
              <>
                <h3>No results yet</h3>
                <p>Click Run Scan to search all 2,851 NASDAQ common stocks. Loosen filters (lower ADR%, RS Rank, Volume) if no results appear.</p>
                <Button onClick={() => scanMutation.mutate()} disabled={isScanning} className="scan-btn-empty" data-testid="button-scan-empty">
                  Run Scan
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="table-wrapper">
            {isScanning && (
              <div className="scanning-banner">
                <span className="scanning-dot" />
                {(progress?.done ?? 0) < Math.round((progress?.total ?? 2851) / 2)
                  ? `Phase 1: Pre-filtering ${progress?.done ?? 0} / ${progress?.total ?? 2851} tickers...`
                  : `Phase 2: Deep analysis ${progress?.done ?? 0} / ${progress?.total ?? 2851} — results loading...`
                }
              </div>
            )}
            <table className="scan-table" data-testid="scan-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort("ticker")} className="th-sortable">Ticker <SortIcon col="ticker" /></th>
                  <th className="th-name">Company</th>
                  <th onClick={() => handleSort("price")} className="th-sortable">Price <SortIcon col="price" /></th>
                  <th onClick={() => handleSort("priceChange1d")} className="th-sortable">1D% <SortIcon col="priceChange1d" /></th>
                  <th onClick={() => handleSort("marketCap")} className="th-sortable">Mkt Cap <SortIcon col="marketCap" /></th>
                  <th onClick={() => handleSort("adrPct")} className="th-sortable">ADR% <SortIcon col="adrPct" /></th>
                  <th onClick={() => handleSort("rs1m")} className="th-sortable">RS 1M <SortIcon col="rs1m" /></th>
                  <th onClick={() => handleSort("rs3m")} className="th-sortable">RS 3M <SortIcon col="rs3m" /></th>
                  <th onClick={() => handleSort("rs6m")} className="th-sortable">RS 6M <SortIcon col="rs6m" /></th>
                  <th onClick={() => handleSort("rsRank")} className="th-sortable">RS Rank <SortIcon col="rsRank" /></th>
                  <th onClick={() => handleSort("avgVolume20d")} className="th-sortable">Avg Vol <SortIcon col="avgVolume20d" /></th>
                  <th onClick={() => handleSort("float")} className="th-sortable">Float <SortIcon col="float" /></th>
                  <th>Near EMA</th>
                  <th>Pattern</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={row.id}
                    className={`scan-row ${selectedTicker === row.ticker ? "selected" : ""} ${row.pattern === "ep" ? "row-ep" : ""}`}
                    onClick={() => setSelectedTicker(t => t === row.ticker ? null : row.ticker)}
                    data-testid={`row-stock-${row.ticker}`}
                  >
                    <td className="td-ticker">
                      <span className="ticker-sym">{row.ticker}</span>
                    </td>
                    <td className="td-name">{row.companyName}</td>
                    <td className="td-num">${fmt(row.price)}</td>
                    <td className={`td-num ${(row.priceChange1d ?? 0) >= 0 ? "pos" : "neg"}`}>
                      {(row.priceChange1d ?? 0) >= 0 ? "+" : ""}{fmt(row.priceChange1d)}%
                    </td>
                    <td className="td-num">{fmtM(row.marketCap)}</td>
                    <td className="td-num adr">{fmt(row.adrPct)}%</td>
                    <td className={`td-num ${(row.rs1m ?? 0) >= 0 ? "pos" : "neg"}`}>{fmt(row.rs1m, 1)}%</td>
                    <td className={`td-num ${(row.rs3m ?? 0) >= 0 ? "pos" : "neg"}`}>{fmt(row.rs3m, 1)}%</td>
                    <td className={`td-num ${(row.rs6m ?? 0) >= 0 ? "pos" : "neg"}`}>{fmt(row.rs6m, 1)}%</td>
                    <td className="td-rs">
                      <RSBar value={Math.min(100, Math.max(0, (row.rsRank ?? 0) + 50))} />
                    </td>
                    <td className="td-num">{fmtVol(row.avgVolume20d)}</td>
                    <td className="td-num">{fmtM(row.float)}</td>
                    <td className="td-center">
                      {row.nearEma ? (
                        <span className="ema-badge near">✓</span>
                      ) : (
                        <span className="ema-badge far">—</span>
                      )}
                    </td>
                    <td className="td-pattern">
                      {row.pattern && PATTERN_LABELS[row.pattern] ? (
                        <span className={`pattern-badge ${PATTERN_LABELS[row.pattern].color}`}>
                          {PATTERN_LABELS[row.pattern].label}
                          {row.pattern === "ep" && row.epGapPct ? ` +${row.epGapPct.toFixed(0)}%` : ""}
                        </span>
                      ) : "—"}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="watch-btn"
                        onClick={() => watchlistMutation.mutate(row.ticker)}
                        data-testid={`button-watch-${row.ticker}`}
                        title="Add to watchlist"
                      >
                        +
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Chart Panel */}
        {selectedTicker && (
          <ChartPanel
            ticker={selectedTicker}
            onClose={() => setSelectedTicker(null)}
          />
        )}
      </main>

      {/* Alert Sheet */}
      <Sheet open={alertPanelOpen} onOpenChange={setAlertPanelOpen}>
        <SheetContent className="alerts-sheet" data-testid="sheet-alerts">
          <SheetHeader>
            <SheetTitle>Breakout Alerts</SheetTitle>
          </SheetHeader>
          <div className="alert-list">
            {alerts.length === 0 ? (
              <div className="alert-empty">No alerts. Run a scan to detect setups.</div>
            ) : (
              alerts.map((alert) => (
                <div key={alert.id} className={`alert-item ${alert.dismissed ? "dismissed" : ""}`} data-testid={`alert-${alert.id}`}>
                  <div className="alert-type-badge" data-type={alert.alertType}>
                    {alert.alertType.toUpperCase()}
                  </div>
                  <div className="alert-content">
                    <div className="alert-msg">{alert.message}</div>
                    <div className="alert-meta">
                      {alert.price && `$${alert.price.toFixed(2)} · `}
                      {new Date(alert.triggeredAt).toLocaleString()}
                    </div>
                  </div>
                  {!alert.dismissed && (
                    <button
                      className="alert-dismiss"
                      onClick={() => dismissAlertMutation.mutate(alert.id)}
                      data-testid={`button-dismiss-${alert.id}`}
                    >×</button>
                  )}
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
