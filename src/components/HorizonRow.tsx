import { memo, useMemo, useRef } from 'react'
import { area, curveMonotoneX } from 'd3'
import { AnimatedNumber } from './AnimatedNumber'

export type RowPoint = {
  /** position on the shared time axis, 0..1 */
  xf: number
  /** position on this row's own time axis, 0..1 */
  localXf: number
  close: number
  /** % return vs period start (minus benchmark, when one is active) */
  v: number
}

export type ScaleMode = 'fibonacci' | 'normal'
export type XDomainMode = 'global' | 'local'

type HorizonRowProps = {
  symbol: string
  pts: RowPoint[]
  /** pixel width of the chart strip, measured by the parent */
  width: number
  /** shared y-domain: max |return| across the whole list */
  max: number
  scaleMode: ScaleMode
  xDomainMode: XDomainMode
  scrubFrac: number | null
  onScrub: (frac: number | null) => void
  editing: boolean
  onRemove: () => void
  fmtPct: (v: number) => string
}

const H = 38
const BANDS = 4

function bandOpacity(band: number) {
  return 0.18 + 0.5 * ((band + 1) / BANDS)
}

function thresholds(scaleMode: ScaleMode, max: number) {
  if (scaleMode === 'fibonacci') {
    return [0, 0.236, 0.382, 0.618, 1].map((ratio) => ratio * max)
  }
  return Array.from({ length: BANDS + 1 }, (_, i) => (i / BANDS) * max)
}

function fmtMoney(value: number) {
  return `$${value >= 1000 ? value.toFixed(0) : value.toFixed(2)}`
}

export const HorizonRow = memo(function HorizonRow({
  symbol,
  pts,
  width,
  max,
  scaleMode,
  xDomainMode,
  scrubFrac,
  onScrub,
  editing,
  onRemove,
  fmtPct,
}: HorizonRowProps) {
  const stripRef = useRef<HTMLDivElement>(null)

  const paths = useMemo(() => {
    if (pts.length < 2 || width <= 0 || max <= 0) return []
    const limits = thresholds(scaleMode, max)
    const out: { d: string; sign: 1 | -1; band: number }[] = []
    const xOf = (p: RowPoint) => (xDomainMode === 'local' ? p.localXf : p.xf)

    for (const sign of [1, -1] as const) {
      for (let band = 0; band < BANDS; band++) {
        const t0 = limits[band]
        const t1 = limits[band + 1]
        const step = Math.max(0.0001, t1 - t0)
        const bandValue = (p: RowPoint) =>
          Math.min(step, Math.max(0, Math.max(0, sign * p.v) - t0))
        const gen = area<RowPoint>()
          .x((p) => xOf(p) * width)
          .curve(curveMonotoneX)
        if (sign > 0) {
          gen.y0(H).y1((p) => H - (bandValue(p) / step) * H)
        } else {
          gen.y0(0).y1((p) => (bandValue(p) / step) * H)
        }
        const d = gen(pts)
        if (d) out.push({ d, sign, band })
      }
    }
    return out
  }, [pts, width, max, scaleMode, xDomainMode])

  const hasData = pts.length >= 2
  const active = useMemo(() => {
    if (scrubFrac == null || !hasData) return null
    let best = pts[0]
    let bestDist = Infinity
    for (const p of pts) {
      const x = xDomainMode === 'local' ? p.localXf : p.xf
      const dist = Math.abs(x - scrubFrac)
      if (dist < bestDist) {
        bestDist = dist
        best = p
      }
    }
    return best
  }, [scrubFrac, hasData, pts, xDomainMode])
  const shown = active ?? (hasData ? pts[pts.length - 1] : null)

  const scrubAt = (e: React.PointerEvent) => {
    if (!hasData) return
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    onScrub(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
  }

  return (
    <div className="row">
      <span className="row-sym">{symbol}</span>
      <div
        ref={stripRef}
        className="strip"
        onPointerDown={scrubAt}
        onPointerMove={scrubAt}
        onPointerUp={() => onScrub(null)}
        onPointerLeave={() => onScrub(null)}
        onPointerCancel={() => onScrub(null)}
      >
        {hasData ? (
          <svg viewBox={`0 0 ${Math.max(1, width)} ${H}`} preserveAspectRatio="none" aria-hidden>
            {paths.map((p, i) => (
              <path
                key={i}
                className="horizon-path"
                d={p.d}
                fill={p.sign > 0 ? 'var(--pos)' : 'var(--neg)'}
                fillOpacity={bandOpacity(p.band)}
              />
            ))}
            {scrubFrac != null && (
              <line
                x1={scrubFrac * width}
                x2={scrubFrac * width}
                y1={0}
                y2={H}
                stroke="var(--ink)"
                strokeOpacity={0.45}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        ) : (
          <span className="nodata">no data</span>
        )}
      </div>
      {editing ? (
        <button type="button" className="row-x" onClick={onRemove} aria-label={`Remove ${symbol}`}>
          ×
        </button>
      ) : shown ? (
        <span className={`row-pct ${shown.v >= 0 ? 'pos' : 'neg'}`}>
          <AnimatedNumber value={shown.v} formatter={fmtPct} />
          {active && <AnimatedNumber value={active.close} formatter={fmtMoney} className="row-price" />}
        </span>
      ) : (
        <span className="row-pct">—</span>
      )}
    </div>
  )
})
