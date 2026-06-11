import { createFileRoute } from '@tanstack/react-router'
import * as d3 from 'd3'
import {
  Activity,
  BarChart3,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'

type Watchlist = Record<string, string[]>
type PriceBar = { date: string; close: number; ts?: number }
type PriceSeries = { symbol: string; prices?: PriceBar[]; interval?: string; error?: string }
type MarketStatus = { open: boolean; time_et: string; weekday: string }

const periods = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', 'max']
const benchmarks = [
  ['none', 'No benchmark'],
  ['SPY', 'S&P 500'],
  ['QQQ', 'Nasdaq 100'],
  ['SMH', 'Semiconductors'],
  ['XLK', 'Technology'],
]

const sectorTone = [
  '#e8960a',
  '#18c96a',
  '#49a7ff',
  '#d978ff',
  '#ff5f57',
  '#9ad94b',
  '#f4d35e',
  '#6ee7f9',
]

export const Route = createFileRoute('/')({
  component: StockDashboard,
})

function StockDashboard() {
  const [watchlist, setWatchlist] = useState<Watchlist>({})
  const [priceData, setPriceData] = useState<PriceSeries[]>([])
  const [period, setPeriod] = useState('1d')
  const [benchmark, setBenchmark] = useState('none')
  const [symbol, setSymbol] = useState('')
  const [sector, setSector] = useState('')
  const [market, setMarket] = useState<MarketStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const sectors = Object.keys(watchlist)
  const symbols = useMemo(() => Object.values(watchlist).flat(), [watchlist])

  async function api<T>(path: string, init?: RequestInit) {
    const response = await fetch(path, init)
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(body?.error || response.statusText)
    }
    return body as T
  }

  async function refreshWatchlist() {
    const nextWatchlist = await api<Watchlist>('/api/watchlist')
    setWatchlist(nextWatchlist)
    if (!sector) setSector(Object.keys(nextWatchlist)[0] || 'AI Models')
  }

  async function refreshPrices(nextSymbols = symbols, nextBenchmark = benchmark, nextPeriod = period) {
    const fetchSymbols = [...nextSymbols]
    if (nextBenchmark !== 'none' && !fetchSymbols.includes(nextBenchmark)) {
      fetchSymbols.push(nextBenchmark)
    }
    if (fetchSymbols.length === 0) {
      setPriceData([])
      return
    }
    setLoading(true)
    try {
      const query = new URLSearchParams({
        symbols: fetchSymbols.join(','),
        period: nextPeriod,
      })
      setPriceData(await api<PriceSeries[]>(`/api/prices?${query}`))
    } finally {
      setLoading(false)
    }
  }

  async function refreshMarket() {
    setMarket(await api<MarketStatus>('/api/market_status'))
  }

  useEffect(() => {
    refreshWatchlist()
      .then(refreshMarket)
      .catch((caught) => setError(String(caught.message || caught)))
  }, [])

  useEffect(() => {
    refreshPrices()
      .catch((caught) => setError(String(caught.message || caught)))
  }, [symbols.join(','), benchmark, period])

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshMarket().catch(() => undefined)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  async function addTicker(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      const next = await api<Watchlist>('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, sector }),
      })
      setWatchlist(next)
      setSymbol('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function removeTicker(ticker: string) {
    setWatchlist(await api<Watchlist>(`/api/watchlist/${ticker}`, { method: 'DELETE' }))
  }

  const stats = useMemo(() => computeStats(priceData, symbols, benchmark), [priceData, symbols, benchmark])

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div>
            <p className="eyebrow">Speleothems</p>
            <h1>Frank Stocks</h1>
          </div>
          <span className={market?.open ? 'market live' : 'market'}>
            <span />
            {market?.open ? `LIVE ${market.time_et} ET` : 'CLOSED'}
          </span>
        </div>

        <form className="ticker-form" onSubmit={addTicker}>
          <input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value.toUpperCase())}
            placeholder="Ticker"
            maxLength={10}
          />
          <select value={sector} onChange={(event) => setSector(event.target.value)}>
            {sectors.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <button type="submit" title="Add ticker">
            <Plus size={16} />
          </button>
        </form>
        {error ? <p className="form-error">{error}</p> : null}

        <div className="control-group">
          <label>
            <Settings2 size={15} />
            Benchmark
          </label>
          <select value={benchmark} onChange={(event) => setBenchmark(event.target.value)}>
            {benchmarks.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="period-grid">
          {periods.map((value) => (
            <button
              type="button"
              key={value}
              className={value === period ? 'active' : ''}
              onClick={() => setPeriod(value)}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>

        <section className="stats-grid" aria-label="Dashboard stats">
          <Stat label="Benchmark" value={stats.benchmark.value} meta={stats.benchmark.meta} tone={stats.benchmark.tone} />
          <Stat label="Top" value={stats.top.value} meta={stats.top.meta} tone="positive" />
          <Stat label="Worst" value={stats.worst.value} meta={stats.worst.meta} tone="negative" />
          <Stat label="Average" value={stats.average.value} meta={stats.average.meta} tone={stats.average.tone} />
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">TanStack Start · Yahoo Finance</p>
            <h2>% return overlay</h2>
          </div>
          <button type="button" onClick={() => refreshPrices()} className="refresh-button">
            <RefreshCw size={16} />
            Refresh
          </button>
        </header>

        <ReturnChart
          watchlist={watchlist}
          priceData={priceData}
          benchmark={benchmark}
          loading={loading}
          onRemove={removeTicker}
        />
      </section>
    </main>
  )
}

function Stat(props: { label: string; value: string; meta: string; tone?: string }) {
  return (
    <article className={`stat ${props.tone || ''}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.meta}</small>
    </article>
  )
}

function ReturnChart(props: {
  watchlist: Watchlist
  priceData: PriceSeries[]
  benchmark: string
  loading: boolean
  onRemove: (symbol: string) => void
}) {
  const rows = useMemo(() => {
    const benchmarkSeries = props.priceData.find((item) => item.symbol === props.benchmark)
    return Object.entries(props.watchlist).flatMap(([sectorName, sectorSymbols], sectorIndex) =>
      sectorSymbols.map((ticker) => {
        const series = props.priceData.find((item) => item.symbol === ticker)
        const values = toReturnPoints(series?.prices || [], benchmarkSeries?.prices || [])
        return {
          sectorName,
          sectorIndex,
          symbol: ticker,
          values,
          latest: values.at(-1)?.value ?? 0,
          price: series?.prices?.at(-1)?.close,
          error: series?.error,
        }
      }),
    )
  }, [props.watchlist, props.priceData, props.benchmark])

  const maxAbs = Math.max(1, ...rows.flatMap((row) => row.values.map((point) => Math.abs(point.value))))
  const width = 980
  const rowHeight = 34
  const left = 172
  const right = 44
  const top = 24
  const height = Math.max(420, top + rows.length * rowHeight + 36)
  const x = d3.scaleTime().range([left, width - right])
  const y = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([rowHeight - 5, 5])

  const allDates = rows.flatMap((row) => row.values.map((point) => point.date.getTime()))
  if (allDates.length > 0) {
    x.domain([new Date(Math.min(...allDates)), new Date(Math.max(...allDates))])
  } else {
    x.domain([new Date(Date.now() - 86_400_000), new Date()])
  }

  const line = d3
    .line<{ date: Date; value: number }>()
    .x((point) => x(point.date))
    .y((point) => y(point.value))
    .curve(d3.curveMonotoneX)

  if (props.loading && rows.every((row) => row.values.length === 0)) {
    return (
      <div className="chart-empty">
        <Activity size={18} />
        加载数据中...
      </div>
    )
  }

  return (
    <div className="chart-panel">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Stock returns chart">
        <defs>
          <linearGradient id="positive-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#18c96a" stopOpacity="0.44" />
            <stop offset="100%" stopColor="#18c96a" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="negative-fill" x1="0" x2="0" y1="1" y2="0">
            <stop offset="0%" stopColor="#e84040" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#e84040" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <line x1={left} x2={width - right} y1={top - 10} y2={top - 10} className="axis-line" />
        {x.ticks(6).map((tick) => (
          <g key={tick.toISOString()} transform={`translate(${x(tick)},0)`}>
            <line y1={top - 14} y2={height - 22} className="grid-line" />
            <text y={height - 8} className="axis-label" textAnchor="middle">
              {d3.timeFormat('%b %d')(tick)}
            </text>
          </g>
        ))}
        {rows.map((row, index) => {
          const offset = top + index * rowHeight
          const zeroY = offset + y(0)
          const path = line(row.values) || ''
          const tone = row.latest >= 0 ? 'positive' : 'negative'
          return (
            <g key={`${row.sectorName}-${row.symbol}`} transform={`translate(0, ${offset})`} className="chart-row">
              <rect x={0} y={0} width={width} height={rowHeight} className="row-bg" />
              <rect x={14} y={9} width={4} height={16} fill={sectorTone[row.sectorIndex % sectorTone.length]} />
              <text x={28} y={15} className="sector-label">
                {row.sectorName}
              </text>
              <text x={28} y={29} className="symbol-label">
                {row.symbol}
              </text>
              <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="zero-line" />
              {row.values.length > 1 ? (
                <>
                  <path d={path} className={`return-line ${tone}`} />
                  <circle cx={x(row.values.at(-1)!.date)} cy={y(row.values.at(-1)!.value)} r={3.2} className={tone} />
                </>
              ) : (
                <text x={left} y={21} className="missing-label">
                  {row.error || 'No data'}
                </text>
              )}
              <text x={width - 34} y={16} className={`return-label ${tone}`} textAnchor="end">
                {formatPct(row.latest)}
              </text>
              <text x={width - 34} y={29} className="price-label" textAnchor="end">
                {row.price ? `$${row.price.toFixed(2)}` : ''}
              </text>
              <foreignObject x={width - 27} y={5} width={20} height={22}>
                <button className="row-delete" type="button" onClick={() => props.onRemove(row.symbol)} title="Remove ticker">
                  <Trash2 size={13} />
                </button>
              </foreignObject>
              <line x1={left} x2={width - right} y1={zeroY - offset} y2={zeroY - offset} className="hit-line" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function toReturnPoints(prices: PriceBar[], benchmarkPrices: PriceBar[]) {
  if (prices.length < 2) return []
  const base = prices[0].close || 1
  const benchmarkBase = benchmarkPrices[0]?.close || 0
  const benchmarkReturn = benchmarkBase
    ? (benchmarkPrices.at(-1)!.close - benchmarkBase) / benchmarkBase * 100
    : 0

  return prices.map((point) => {
    const raw = ((point.close - base) / base) * 100
    return {
      date: new Date(point.ts || point.date),
      value: raw - benchmarkReturn,
    }
  })
}

function computeStats(data: PriceSeries[], symbols: string[], benchmark: string) {
  const returns = symbols
    .map((symbol) => {
      const series = data.find((item) => item.symbol === symbol)
      const prices = series?.prices || []
      if (prices.length < 2) return null
      const first = prices[0].close
      const last = prices.at(-1)!.close
      return { symbol, pct: ((last - first) / first) * 100 }
    })
    .filter(Boolean) as Array<{ symbol: string; pct: number }>

  returns.sort((a, b) => b.pct - a.pct)

  const benchmarkSeries = data.find((item) => item.symbol === benchmark)
  const benchmarkPct = (() => {
    const prices = benchmarkSeries?.prices || []
    if (benchmark === 'none' || prices.length < 2) return null
    return ((prices.at(-1)!.close - prices[0].close) / prices[0].close) * 100
  })()

  const average = returns.length
    ? returns.reduce((sum, item) => sum + item.pct, 0) / returns.length
    : null

  return {
    benchmark: {
      value: benchmarkPct === null ? '—' : formatPct(benchmarkPct),
      meta: benchmark === 'none' ? 'No benchmark selected' : benchmark,
      tone: benchmarkPct === null ? '' : benchmarkPct >= 0 ? 'positive' : 'negative',
    },
    top: {
      value: returns[0] ? formatPct(returns[0].pct) : '—',
      meta: returns[0]?.symbol || 'No watchlist data',
    },
    worst: {
      value: returns.at(-1) ? formatPct(returns.at(-1)!.pct) : '—',
      meta: returns.at(-1)?.symbol || 'No watchlist data',
    },
    average: {
      value: average === null ? '—' : formatPct(average),
      meta: 'Watchlist average',
      tone: average === null ? '' : average >= 0 ? 'positive' : 'negative',
    },
  }
}

function formatPct(value: number) {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}
