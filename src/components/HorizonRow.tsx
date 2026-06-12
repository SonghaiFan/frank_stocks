import { memo, useMemo, useRef } from 'react'
import { area, curveMonotoneX } from 'd3'

export type RowPoint = {
  /** position on the shared time axis, 0..1 */
  xf: number
  close: number
  /** % return vs period start (minus benchmark, when one is active) */
  v: number
}

type HorizonRowProps = {
  symbol: string
  pts: RowPoint[]
  /** pixel width of the chart strip, measured by the parent */
  width: number
  /** shared y-domain: max |return| across the whole list */
  max: number
  scrubFrac: number | null
  onScrub: (frac: number | null) => void
  editing: boolean
  onRemove: () => void
  fmtPct: (v: number) => string
}

const BANDS = 3
const H = 38
const BAND_OPACITY = [0.22, 0.42, 0.62]

function fmtMoney(value: number) {
  return `$${value >= 1000 ? value.toFixed(0) : value.toFixed(2)}`
}

export const HorizonRow = memo(function HorizonRow({
  symbol,
  pts,
  width,
  max,
  scrubFrac,
  onScrub,
  editing,
  onRemove,
  fmtPct,
}: HorizonRowProps) {
  const stripRef = useRef<HTMLDivElement>(null)

  const paths = useMemo(() => {
    if (pts.length < 2 || width <= 0 || max <= 0) return []
    const step = max / BANDS
    const out: { d: string; sign: 1 | -1; band: number }[] = []

    for (const sign of [1, -1] as const) {
      for (let band = 0; band < BANDS; band++) {
        const t0 = band * step
        const bandValue = (p: RowPoint) =>
          Math.min(step, Math.max(0, Math.max(0, sign * p.v) - t0))
        const gen = area<RowPoint>()
          .x((p) => p.xf * width)
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
  }, [pts, width, max])

  const hasData = pts.length >= 2
  const active = useMemo(() => {
    if (scrubFrac == null || !hasData) return null
    let best = pts[0]
    let bestDist = Infinity
    for (const p of pts) {
      const dist = Math.abs(p.xf - scrubFrac)
      if (dist < bestDist) {
        bestDist = dist
        best = p
      }
    }
    return best
  }, [scrubFrac, hasData, pts])
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
                d={p.d}
                fill={p.sign > 0 ? 'var(--pos)' : 'var(--neg)'}
                fillOpacity={BAND_OPACITY[p.band]}
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
          {fmtPct(shown.v)}
          {active && <small>{fmtMoney(active.close)}</small>}
        </span>
      ) : (
        <span className="row-pct">—</span>
      )}
    </div>
  )
})
