import { createFileRoute } from '@tanstack/react-router'
import { QueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

type CachedApiResult = {
  data: unknown
  stale: boolean
  updatedAt: number
}

declare global {
  interface Window {
    __stocksQueryFetch?: (path: string, opts?: RequestInit & { force?: boolean }) => Promise<unknown>
    __stocksGetCachedApi?: (path: string) => CachedApiResult | null
  }
}

export const Route = createFileRoute('/')({
  component: StockDashboard,
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 15 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

function apiStaleTime(path: string) {
  if (path.startsWith('/market_status')) return 20_000
  if (path.startsWith('/watchlist')) return 5 * 60_000
  if (path.includes('period=1d')) return 20_000
  if (path.includes('period=5d')) return 90_000
  if (path.includes('period=1mo')) return 10 * 60_000
  return 6 * 60 * 60_000
}

function apiUrl(path: string) {
  if (path.startsWith('http')) return path
  return path.startsWith('/api') ? path : `/api${path}`
}

function queryKey(path: string) {
  return ['stocks-api', path] as const
}

function installQueryBridge() {
  if (typeof window === 'undefined') return
  document.documentElement.dataset.stocksQueryBridge = 'ready'

  window.__stocksGetCachedApi = (path) => {
    const state = queryClient.getQueryState(queryKey(path))
    const data = queryClient.getQueryData(queryKey(path))
    if (!state || data === undefined) return null

    return {
      data,
      stale: Date.now() - state.dataUpdatedAt > apiStaleTime(path),
      updatedAt: state.dataUpdatedAt,
    }
  }

  window.__stocksQueryFetch = async (path, opts = {}) => {
    const currentCount = Number(document.documentElement.dataset.stocksQueryFetches || 0)
    document.documentElement.dataset.stocksQueryFetches = String(currentCount + 1)
    const method = (opts.method || 'GET').toUpperCase()
    const url = apiUrl(path)

    if (method !== 'GET') {
      const response = await fetch(url, opts)
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || response.statusText)
      queryClient.removeQueries({ queryKey: ['stocks-api'] })
      return body
    }

    const staleTime = opts.force ? 0 : apiStaleTime(path)
    return queryClient.fetchQuery({
      queryKey: queryKey(path),
      staleTime,
      queryFn: async ({ signal }) => {
        const response = await fetch(url, {
          signal: opts.signal || signal,
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error || response.statusText)
        return body
      },
    })
  }
}

installQueryBridge()

function StockDashboard() {
  const [html, setHtml] = useState('')
  const booted = useRef(false)

  useEffect(() => {
    installQueryBridge()

    let cancelled = false

    fetch('/stock-dashboard-body.html')
      .then((response) => response.text())
      .then((bodyHtml) => {
        if (!cancelled) setHtml(bodyHtml)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!html || booted.current) return
    booted.current = true

    const loadScript = (id: string, src: string) =>
      new Promise<void>((resolve, reject) => {
        const existing = document.getElementById(id) as HTMLScriptElement | null
        if (existing) {
          if (existing.dataset.loaded === 'true') resolve()
          else existing.addEventListener('load', () => resolve(), { once: true })
          return
        }

        const script = document.createElement('script')
        script.id = id
        script.src = src
        script.async = false
        script.addEventListener('load', () => {
          script.dataset.loaded = 'true'
          resolve()
        })
        script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)))
        document.body.appendChild(script)
      })

    installQueryBridge()

    loadScript('stocks-d3', 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js')
      .then(() => loadScript('stocks-lucide', 'https://unpkg.com/lucide@latest'))
      .then(() => loadScript('stock-dashboard-app', '/stock-dashboard-app.js'))
      .catch((error) => {
        console.error(error)
      })
  }, [html])

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
