import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import YahooFinance from 'yahoo-finance2'

export type Watchlist = Record<string, string[]>

export type PriceBar = {
  date: string
  close: number
  ts?: number
}

export type PriceSeries = {
  symbol: string
  prices?: PriceBar[]
  interval?: string
  error?: string
}

export type Quote = {
  symbol: string
  price?: number
  open?: number
  change?: number
  pct_change?: number
  ts?: number
  time_et?: string
  bar?: PriceBar
  error?: string
}

type YahooChartQuote = {
  date: Date
  open?: number | null
  close?: number | null
}

type YahooChartResult = {
  quotes?: YahooChartQuote[]
}

const rootDir = process.cwd()
const watchlistFile = path.join(rootDir, 'watchlist.json')
const cacheFile = path.join(rootDir, 'price_cache.json')
const yahooFinance = new YahooFinance()

const etFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const etClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const etWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'long',
})

const etShortTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export const defaultWatchlist: Watchlist = {
  'AI Models': ['MSFT', 'GOOGL', 'META', 'AMZN', 'ORCL', 'IBM'],
  'AI Apps': ['PLTR', 'CRM', 'NOW', 'SNOW', 'MDB', 'DDOG', 'AI', 'PATH', 'BBAI'],
  'Chips Compute': ['NVDA', 'AMD', 'INTC', 'QCOM', 'ARM'],
  'Chips Memory': ['MU', 'WDC', 'STX'],
  'Chips Equipment': ['ASML', 'LRCX', 'AMAT', 'KLAC', 'CDNS', 'SNPS', 'TER'],
  'DC Infra': ['AVGO', 'ANET', 'VRT', 'SMCI', 'DELL', 'HPE', 'NTAP', 'CSCO'],
  Cloud: ['NET', 'FSLY', 'AKAM', 'ESTC', 'GTLB', 'ZS', 'OKTA'],
  Nuclear: ['CEG', 'VST', 'NRG', 'CCJ', 'LEU', 'SMR', 'NNE'],
  'Grid & Renewables': ['GEV', 'ETN', 'NEE', 'AES', 'BE', 'ENPH', 'FSLR', 'PCG'],
  'Oil & Gas': ['XOM', 'CVX', 'COP', 'OXY', 'SLB'],
  Autonomy: ['TSLA', 'GOOGL', 'MBLY', 'AUR', 'RCAT', 'ACHR', 'JOBY'],
  Defense: ['LMT', 'RTX', 'NOC', 'GD', 'BA', 'KTOS', 'RKLB', 'ASTS'],
  BioHealth: ['ISRG', 'NVAX', 'RXRX', 'SDGR', 'ILMN', 'TMO', 'DXCM'],
  Fintech: ['V', 'MA', 'PYPL', 'XYZ', 'AFRM', 'COIN', 'HOOD'],
  Consumer: ['NFLX', 'SPOT', 'TTWO', 'RBLX', 'APP', 'TTD'],
}

const validPeriods = new Set([
  '1d',
  '5d',
  '1mo',
  '3mo',
  '6mo',
  '1y',
  '2y',
  '5y',
  '10y',
  'ytd',
  'max',
])

const cacheablePeriods = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max'])

function todayEt() {
  return etFormatter.format(new Date())
}

function responseJson(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase()
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value, null, 2))
}

export async function loadWatchlist(): Promise<Watchlist> {
  if (existsSync(watchlistFile)) {
    try {
      const data = JSON.parse(await readFile(watchlistFile, 'utf8')) as Watchlist
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        return data
      }
    } catch {
      // Fall through and recreate a valid watchlist file.
    }
  }

  await saveWatchlist(defaultWatchlist)
  return structuredClone(defaultWatchlist)
}

export async function saveWatchlist(watchlist: Watchlist) {
  await writeJson(watchlistFile, watchlist)
}

export async function addSymbol(symbol: string, sector: string) {
  const normalized = normalizeSymbol(symbol)
  const targetSector = sector.trim() || 'AI Models'

  if (!normalized) {
    return responseJson({ error: 'symbol required' }, { status: 400 })
  }

  const watchlist = await loadWatchlist()
  watchlist[targetSector] ??= []

  const exists = Object.values(watchlist).some((symbols) => symbols.includes(normalized))
  if (!exists) {
    watchlist[targetSector].push(normalized)
    await saveWatchlist(watchlist)
  }

  return responseJson(watchlist)
}

export async function removeSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol)
  const watchlist = await loadWatchlist()

  for (const symbols of Object.values(watchlist)) {
    const index = symbols.indexOf(normalized)
    if (index >= 0) {
      symbols.splice(index, 1)
      break
    }
  }

  await saveWatchlist(watchlist)
  return watchlist
}

async function loadCache(): Promise<{ date: string; data: Record<string, PriceBar[]> }> {
  if (existsSync(cacheFile)) {
    try {
      const cache = JSON.parse(await readFile(cacheFile, 'utf8'))
      if (cache?.date === todayEt() && cache?.data && typeof cache.data === 'object') {
        return cache
      }
    } catch {
      // Ignore invalid cache files.
    }
  }

  return { date: todayEt(), data: {} }
}

async function setCachedPrices(symbol: string, period: string, prices: PriceBar[]) {
  const cache = await loadCache()
  cache.data[`${symbol}|${period}`] = prices
  await writeJson(cacheFile, cache)
}

export function getInterval(period: string) {
  if (period === '1d') return '1m'
  if (period === '5d') return '1h'
  return '1d'
}

function normalizePeriod(period: string | null) {
  const clean = (period || '3mo').trim().toLowerCase()
  return validPeriods.has(clean) ? clean : '3mo'
}

function periodStart(period: string) {
  const now = new Date()
  const start = new Date(now)

  if (period === '1d') start.setDate(now.getDate() - 1)
  else if (period === '5d') start.setDate(now.getDate() - 6)
  else if (period === '1mo') start.setMonth(now.getMonth() - 1)
  else if (period === '3mo') start.setMonth(now.getMonth() - 3)
  else if (period === '6mo') start.setMonth(now.getMonth() - 6)
  else if (period === '1y') start.setFullYear(now.getFullYear() - 1)
  else if (period === '2y') start.setFullYear(now.getFullYear() - 2)
  else if (period === '5y') start.setFullYear(now.getFullYear() - 5)
  else if (period === '10y') start.setFullYear(now.getFullYear() - 10)
  else if (period === 'ytd') return new Date(now.getFullYear(), 0, 1)
  else if (period === 'max') return new Date('1980-01-01T00:00:00.000Z')

  return start
}

function toDateKey(date: Date) {
  return etFormatter.format(date)
}

function roundPrice(value: number) {
  return Math.round(value * 10000) / 10000
}

export async function getPricesFromQuery(url: string) {
  const requestUrl = new URL(url)
  const symbols = (requestUrl.searchParams.get('symbols') || '')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean)
  const period = normalizePeriod(requestUrl.searchParams.get('period'))

  if (symbols.length === 0) return []

  const interval = getInterval(period)
  const cacheable = cacheablePeriods.has(period)
  const cache = cacheable ? await loadCache() : null
  const result: PriceSeries[] = []

  for (const symbol of symbols) {
    try {
      const cacheKey = `${symbol}|${period}`
      if (cacheable && cache?.data[cacheKey]) {
        result.push({ symbol, prices: cache.data[cacheKey], interval })
        continue
      }

      const rows = (await yahooFinance.chart(symbol, {
        period1: periodStart(period),
        period2: new Date(),
        interval,
      })) as YahooChartResult
      const quotes = rows.quotes || []
      const today = todayEt()

      const prices = quotes
        .filter((quote) => typeof quote.close === 'number' && quote.date instanceof Date)
        .filter((quote) => period !== '1d' || toDateKey(quote.date) === today)
        .map((quote) => ({
          date: interval === '1d' ? toDateKey(quote.date) : quote.date.toISOString(),
          close: roundPrice(quote.close as number),
          ...(interval === '1d' ? {} : { ts: quote.date.getTime() }),
        }))

      if (cacheable) {
        await setCachedPrices(symbol, period, prices)
      }

      result.push({ symbol, prices, interval })
    } catch (error) {
      result.push({
        symbol,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

export async function getQuotesFromQuery(url: string) {
  const requestUrl = new URL(url)
  const symbols = (requestUrl.searchParams.get('symbols') || '')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean)

  if (symbols.length === 0) return []

  const result: Quote[] = []

  for (const symbol of symbols) {
    try {
      const rows = (await yahooFinance.chart(symbol, {
        period1: periodStart('1d'),
        period2: new Date(),
        interval: '1m',
      })) as YahooChartResult
      const quotes = (rows.quotes || []).filter(
        (quote) =>
          typeof quote.close === 'number' &&
          typeof quote.open === 'number' &&
          quote.date instanceof Date,
      )

      if (quotes.length === 0) {
        result.push({ symbol, error: 'no data' })
        continue
      }

      const first = quotes[0]
      const last = quotes[quotes.length - 1]
      const lastPrice = roundPrice(last.close as number)
      const openPrice = roundPrice(first.open as number)
      const change = roundPrice(lastPrice - openPrice)
      const pctChange = openPrice ? roundPrice((change / openPrice) * 100) : 0

      result.push({
        symbol,
        price: lastPrice,
        open: openPrice,
        change,
        pct_change: pctChange,
        ts: last.date.getTime(),
        time_et: etShortTimeFormatter.format(last.date),
        bar: {
          date: last.date.toISOString(),
          close: lastPrice,
          ts: last.date.getTime(),
        },
      })
    } catch (error) {
      result.push({
        symbol,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}

export function getMarketStatus() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const weekday = parts.find((part) => part.type === 'weekday')?.value
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0)
  const minutes = hour * 60 + minute
  const isWeekday = weekday !== 'Sat' && weekday !== 'Sun'
  const open = isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60

  return {
    open,
    time_et: etClockFormatter.format(now),
    weekday: etWeekdayFormatter.format(now),
  }
}
