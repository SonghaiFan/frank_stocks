import { createFileRoute } from '@tanstack/react-router'
import {
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedNumber } from '~/components/AnimatedNumber'
import { HorizonRow } from '~/components/HorizonRow'
import type { RowPoint, ScaleMode, XDomainMode } from '~/components/HorizonRow'

export const Route = createFileRoute('/')({
  component: StockApp,
})

type Watchlist = Record<string, string[]>
type PriceBar = { date: string; close: number; ts?: number }
type PriceSeries = { symbol: string; prices?: PriceBar[]; error?: string }
type MarketStatus = { open: boolean; time_et: string; weekday: string }

const PERIODS = [
  { key: '1d', label: 'D' },
  { key: '5d', label: 'W' },
  { key: '1mo', label: 'M' },
  { key: '6mo', label: '6M' },
  { key: '1y', label: 'Y' },
  { key: '5y', label: '5Y' },
  { key: 'max', label: 'MAX' },
] as const

type Period = (typeof PERIODS)[number]['key']
type DomainMode = XDomainMode

const BENCHMARKS = [
  { key: 'none', label: 'No benchmark' },
  { key: '^GSPC', label: 'vs S&P 500' },
  { key: '^IXIC', label: 'vs Nasdaq' },
  { key: '^DJI', label: 'vs Dow' },
] as const

const SECTOR_LABELS: Record<string, string> = {
  'AI Models': 'AI Models',
  'AI Apps': 'AI Apps',
  'Chips Compute': 'Chips · Compute',
  'Chips Memory': 'Chips · Memory',
  'Chips Equipment': 'Chips · Equipment',
  'DC Infra': 'DC Infrastructure',
  Cloud: 'Cloud & CDN',
  Nuclear: 'Nuclear Power',
  'Grid & Renewables': 'Grid & Renewables',
  'Oil & Gas': 'Oil & Gas',
  Autonomy: 'Autonomy & Robotics',
  Defense: 'Defense & Space',
  BioHealth: 'Biotech & Health AI',
  Fintech: 'Fintech & Payments',
  Consumer: 'Consumer & Media',
}

const DEFAULT_SECTORS = Object.keys(SECTOR_LABELS)

// Row grid chrome: symbol + value + gaps (keep in sync with app.css .row).
const NON_CHART_WIDTH_MOBILE = 46 + 64 + 12
const NON_CHART_WIDTH_DESKTOP = 54 + 74 + 20

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || response.statusText)
  return body as T
}

function priceStaleTime(period: Period) {
  if (period === '1d') return 20_000
  if (period === '5d') return 90_000
  if (period === '1mo') return 10 * 60_000
  return 6 * 60 * 60_000
}

const etTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const etDayTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const etDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
})

const utcDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
})

const utcDayYear = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const utcMonthYear = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  year: 'numeric',
})

function fmtDate(date: string, period: Period) {
  const intraday = date.includes('T')
  const d = intraday ? new Date(date) : new Date(`${date}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  if (period === '1d') return intraday ? `${etTime.format(d)} ET` : etDay.format(d)
  if (period === '5d') return intraday ? etDayTime.format(d) : etDay.format(d)
  if (period === '5y' || period === 'max') return utcMonthYear.format(d)
  if (intraday) return etDay.format(d)
  if (period === '6mo' || period === '1y') return utcDayYear.format(d)
  return utcDay.format(d)
}

function fmtCompactPct(value: number, digits: number) {
  const sign = value >= 0 ? '+' : '−'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M%`
  if (abs >= 10_000) return `${sign}${(abs / 1000).toFixed(0)}k%`
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}k%`
  return `${sign}${abs.toFixed(digits)}%`
}

/** Measures the list width so every row shares one chart width. */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width)
      setWidth((prev) => (Math.abs(prev - next) > 4 ? next : prev))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}

type SectionRow = { symbol: string; pts: RowPoint[]; localMax: number }
type Section = { sector: string; rows: SectionRow[] }

function buildModel(watchlist: Watchlist | undefined, series: PriceSeries[] | undefined, benchmark: string) {
  const bySymbol = new Map((series ?? []).map((s) => [s.symbol, s]))

  const benchPct = new Map<string, number>()
  if (benchmark !== 'none') {
    const bench = bySymbol.get(benchmark)
    if (bench?.prices && bench.prices.length > 1) {
      const base = bench.prices[0].close
      for (const bar of bench.prices) {
        benchPct.set(bar.date, ((bar.close - base) / base) * 100)
      }
    }
  }

  // Shared time axis: the union of every bar date, so the scrub crosshair is
  // temporal and stocks with shorter histories start partway into the strip.
  const watchSymbols = new Set(Object.values(watchlist ?? {}).flat())
  const dateSet = new Set<string>()
  for (const s of series ?? []) {
    if (!watchSymbols.has(s.symbol)) continue
    for (const bar of s.prices ?? []) dateSet.add(bar.date)
  }
  const dates = Array.from(dateSet).sort()
  const dateFrac = new Map(dates.map((date, i) => [date, dates.length > 1 ? i / (dates.length - 1) : 0]))

  const magnitudes: number[] = []
  const sections: Section[] = Object.entries(watchlist ?? {})
    .map(([sector, symbols]) => {
      const rows = symbols.map((symbol): SectionRow => {
        const entry = bySymbol.get(symbol)
        if (!entry?.prices || entry.prices.length < 2) return { symbol, pts: [], localMax: 1 }
        const base = entry.prices[0].close
        const rowMagnitudes: number[] = []
        const lastPriceIndex = entry.prices.length - 1
        const pts = entry.prices.map((bar, index) => {
          const v = ((bar.close - base) / base) * 100 - (benchPct.get(bar.date) ?? 0)
          const magnitude = Math.abs(v)
          rowMagnitudes.push(magnitude)
          magnitudes.push(magnitude)
          return {
            xf: dateFrac.get(bar.date) ?? 0,
            localXf: lastPriceIndex > 0 ? index / lastPriceIndex : 0,
            close: bar.close,
            v,
          }
        })
        rowMagnitudes.sort((a, b) => a - b)
        const localMax =
          rowMagnitudes.length > 0 ? rowMagnitudes[Math.floor(0.98 * (rowMagnitudes.length - 1))] : 1
        return { symbol, pts, localMax: localMax || 1 }
      })
      rows.sort((a, b) => (b.pts.at(-1)?.v ?? -Infinity) - (a.pts.at(-1)?.v ?? -Infinity))
      return { sector, rows }
    })
    .filter((section) => section.rows.length > 0)

  // Shared y-domain at the 98th percentile of all |returns|: comparable across
  // rows, but a single outlier can't flatten everyone else's bands.
  magnitudes.sort((a, b) => a - b)
  const globalMax = magnitudes.length > 0 ? magnitudes[Math.floor(0.98 * (magnitudes.length - 1))] : 0

  const returns = sections
    .flatMap((section) => section.rows)
    .filter((row) => row.pts.length >= 2)
    .map((row) => ({ symbol: row.symbol, v: row.pts[row.pts.length - 1].v }))

  const stats =
    returns.length === 0
      ? null
      : {
          avg: returns.reduce((sum, r) => sum + r.v, 0) / returns.length,
          best: returns.reduce((a, b) => (b.v > a.v ? b : a)),
          worst: returns.reduce((a, b) => (b.v < a.v ? b : a)),
        }

  const range = dates.length > 1 ? { start: dates[0], end: dates[dates.length - 1] } : null

  return { sections, dates, globalMax: globalMax || 1, stats, range }
}

function StockApp() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, gcTime: 15 * 60_000 },
        },
      }),
  )
  return (
    <QueryClientProvider client={client}>
      <Dashboard />
    </QueryClientProvider>
  )
}

function Dashboard() {
  const queryClient = useQueryClient()
  const [period, setPeriod] = useState<Period>('1d')
  const [benchmark, setBenchmark] = useState<string>('none')
  const [editing, setEditing] = useState(false)
  const [ranked, setRanked] = useState(false)
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fibonacci')
  const [domainMode, setDomainMode] = useState<DomainMode>('global')
  const [scrubIndex, setScrubIndex] = useState<number | null>(null)
  const [addError, setAddError] = useState('')
  const { ref: listRef, width: listWidth } = useContainerWidth()

  const watchlist = useQuery({
    queryKey: ['watchlist'],
    queryFn: () => getJson<Watchlist>('/api/watchlist'),
    staleTime: 5 * 60_000,
  })

  const market = useQuery({
    queryKey: ['market'],
    queryFn: () => getJson<MarketStatus>('/api/market_status'),
    refetchInterval: 60_000,
  })

  const symbols = useMemo(
    () => Array.from(new Set(Object.values(watchlist.data ?? {}).flat())),
    [watchlist.data],
  )
  const fetchSymbols = useMemo(
    () => (benchmark === 'none' || symbols.includes(benchmark) ? symbols : [...symbols, benchmark]),
    [symbols, benchmark],
  )

  const rowChromeWidth =
    typeof window !== 'undefined' && window.innerWidth >= 520
      ? NON_CHART_WIDTH_DESKTOP
      : NON_CHART_WIDTH_MOBILE
  const chartWidth = Math.max(0, listWidth - rowChromeWidth)
  const points =
    period === 'max'
      ? 100
      : chartWidth > 0
        ? Math.min(800, Math.max(160, Math.round(chartWidth / 20) * 20))
        : 0

  const prices = useQuery({
    queryKey: ['prices', period, points, fetchSymbols.join(',')],
    enabled: fetchSymbols.length > 0 && points > 0,
    queryFn: ({ signal }) =>
      getJson<PriceSeries[]>(
        `/api/prices?symbols=${encodeURIComponent(fetchSymbols.join(','))}&period=${period}&points=${points}`,
        { signal },
      ),
    staleTime: priceStaleTime(period),
    refetchInterval: period === '1d' ? 60_000 : false,
    placeholderData: keepPreviousData,
  })

  const addStock = useMutation({
    mutationFn: ({ symbol, sector }: { symbol: string; sector: string }) =>
      getJson<Watchlist>('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, sector }),
      }),
    onSuccess: (data) => {
      setAddError('')
      queryClient.setQueryData(['watchlist'], data)
    },
    onError: (error) => setAddError(error.message),
  })

  const removeStock = useMutation({
    mutationFn: (symbol: string) =>
      getJson<Watchlist>(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
    onSuccess: (data) => queryClient.setQueryData(['watchlist'], data),
  })

  const { sections, dates, globalMax, stats, range } = useMemo(
    () => buildModel(watchlist.data, prices.data, benchmark),
    [watchlist.data, prices.data, benchmark],
  )
  const displaySections = useMemo(() => {
    if (!ranked) return sections
    return [
      {
        sector: '__ranked__',
        rows: sections
          .flatMap((section) => section.rows)
          .sort((a, b) => (b.pts.at(-1)?.v ?? -Infinity) - (a.pts.at(-1)?.v ?? -Infinity)),
      },
    ]
  }, [ranked, sections])

  const scrubRaf = useRef(0)
  const handleScrub = useCallback(
    (frac: number | null) => {
      cancelAnimationFrame(scrubRaf.current)
      if (frac == null || dates.length === 0) {
        setScrubIndex(null)
        return
      }
      const nextIndex = Math.max(0, Math.min(dates.length - 1, Math.round(frac * (dates.length - 1))))
      scrubRaf.current = requestAnimationFrame(() => setScrubIndex(nextIndex))
    },
    [dates.length],
  )

  useEffect(() => {
    setScrubIndex(null)
  }, [period, benchmark, dates.length])

  useEffect(() => () => cancelAnimationFrame(scrubRaf.current), [])

  const scrubFrac =
    scrubIndex != null && dates.length > 1 ? scrubIndex / (dates.length - 1) : null
  const scrubDate = domainMode === 'global' && scrubIndex != null ? (dates[scrubIndex] ?? null) : null
  const scrubProgress =
    domainMode === 'local' && scrubFrac != null ? `${Math.round(scrubFrac * 100)}%` : ''

  const fmtPct = useCallback(
    (v: number) => fmtCompactPct(v, period === '1d' ? 2 : 1),
    [period],
  )

  const handleAdd = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const symbol = String(data.get('symbol') ?? '').trim().toUpperCase()
    const sector = String(data.get('sector') ?? DEFAULT_SECTORS[0])
    if (!symbol) return
    addStock.mutate(
      { symbol, sector },
      { onSuccess: () => form.reset() },
    )
  }

  const sectors = watchlist.data ? Object.keys(watchlist.data) : DEFAULT_SECTORS
  const benchmarkActive = benchmark !== 'none'

  return (
    <div className="app">
      <header className="masthead">
        <h1>Frank Stocks</h1>
        <div className={market.data?.open ? 'market live' : 'market'}>
          <span className="dot" />
          {market.data ? (market.data.open ? `${market.data.time_et.slice(0, 5)} ET` : 'Closed') : '—'}
        </div>
      </header>

      <nav className="controls">
        <div className="periods">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          className="bench"
          value={benchmark}
          onChange={(event) => setBenchmark(event.target.value)}
          aria-label="Benchmark"
        >
          {BENCHMARKS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
      </nav>

      <section className="summary">
        {stats ? (
          <>
            <div className="summary-item">
              <span>{benchmarkActive ? 'Avg excess' : 'Avg'}</span>
              <strong className={stats.avg >= 0 ? 'pos' : 'neg'}>
                <AnimatedNumber value={stats.avg} formatter={fmtPct} />
              </strong>
            </div>
            <div className="summary-item">
              <span>Best</span>
              <strong className="pos">
                {stats.best.symbol} <AnimatedNumber value={stats.best.v} formatter={fmtPct} />
              </strong>
            </div>
            <div className="summary-item">
              <span>Worst</span>
              <strong className="neg">
                {stats.worst.symbol} <AnimatedNumber value={stats.worst.v} formatter={fmtPct} />
              </strong>
            </div>
          </>
        ) : (
          <div className="muted">{prices.isPending && fetchSymbols.length > 0 ? 'Loading prices…' : 'No data yet'}</div>
        )}
        <button
          type="button"
          className="rank-toggle"
          aria-pressed={ranked}
          onClick={() => setRanked((value) => !value)}
        >
          Rank
        </button>
        <button
          type="button"
          className="edit-toggle"
          aria-pressed={editing}
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </section>

      {range && (
        <div className="ruler">
          <span>{domainMode === 'local' ? 'Row start' : fmtDate(range.start, period)}</span>
          <span className="ruler-scrub">
            {domainMode === 'local' ? scrubProgress : scrubDate ? fmtDate(scrubDate, period) : ''}
          </span>
          <span>{domainMode === 'local' ? 'Latest' : fmtDate(range.end, period)}</span>
        </div>
      )}

      <main ref={listRef}>
        {displaySections.map((section) => (
          <section key={section.sector} className="sector">
            {!ranked && <h2>{SECTOR_LABELS[section.sector] ?? section.sector}</h2>}
            {section.rows.map((row) => (
              <HorizonRow
                key={row.symbol}
                symbol={row.symbol}
                pts={row.pts}
                width={chartWidth}
                max={domainMode === 'global' ? globalMax : row.localMax}
                scaleMode={scaleMode}
                xDomainMode={domainMode}
                scrubFrac={scrubFrac}
                onScrub={handleScrub}
                editing={editing}
                onRemove={() => removeStock.mutate(row.symbol)}
                fmtPct={fmtPct}
              />
            ))}
          </section>
        ))}

        {prices.isError && (
          <div className="notice">
            Couldn’t load prices.
            <button type="button" onClick={() => prices.refetch()}>
              Retry
            </button>
          </div>
        )}
      </main>

      <section className="advanced" aria-label="Chart settings">
        <label>
          <span>Scale</span>
          <select
            value={scaleMode}
            onChange={(event) => setScaleMode(event.target.value as ScaleMode)}
          >
            <option value="fibonacci">Fibonacci bands</option>
            <option value="normal">Normal</option>
          </select>
        </label>
        <label>
          <span>Domain</span>
          <select
            value={domainMode}
            onChange={(event) => setDomainMode(event.target.value as DomainMode)}
          >
            <option value="global">Global</option>
            <option value="local">Local per stock</option>
          </select>
        </label>
      </section>

      <form className="add" onSubmit={handleAdd}>
        <input
          name="symbol"
          placeholder="Add ticker"
          maxLength={10}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <select name="sector" aria-label="Sector" defaultValue={DEFAULT_SECTORS[0]}>
          {sectors.map((sector) => (
            <option key={sector} value={sector}>
              {SECTOR_LABELS[sector] ?? sector}
            </option>
          ))}
        </select>
        <button type="submit" disabled={addStock.isPending}>
          Add
        </button>
      </form>
      {addError && <p className="form-error">{addError}</p>}

      <footer className="colophon">
        Horizon chart — each strip is % return vs the period start. Darker bands mean a larger
        move; green is up, red is down. Touch or hover a strip to read values across all stocks.
        Data: Yahoo Finance.
      </footer>
    </div>
  )
}
