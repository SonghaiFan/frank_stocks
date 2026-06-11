import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/')({
  component: LegacyStockInterface,
})

function LegacyStockInterface() {
  const [html, setHtml] = useState('')
  const booted = useRef(false)

  useEffect(() => {
    let cancelled = false

    fetch('/legacy-body.html')
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

    loadScript('legacy-d3', 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js')
      .then(() => loadScript('legacy-lucide', 'https://unpkg.com/lucide@latest'))
      .then(() => loadScript('legacy-stock-app', '/legacy-stock-app.js'))
      .catch((error) => {
        console.error(error)
      })
  }, [html])

  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
