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
type SelectedRange = { start: number; end: number }
type DragState =
  | { mode: 'create'; start: number }
  | { mode: 'move'; pointerStart: number; rangeStart: number; rangeEnd: number }

type HorizonRowProps = {
  symbol: string
  pts: RowPoint[]
  /** pixel width of the chart strip, measured by the parent */
  width: number
  /** shared y-domain: max |return| across the whole list */
  max: number
  scaleMode: ScaleMode
  xDomainMode: XDomainMode
  selectedRange: SelectedRange | null
  onRangeChange: (range: SelectedRange | null) => void
  hoverFrac: number | null
  onHoverChange: (frac: number | null) => void
  editing: boolean
  onRemove: () => void
  fmtPct: (v: number) => string
}

const H = 38
const BANDS = 4
const MIN_RANGE_FRACTION = 0.015

function bandOpacity(band: number) {
  return 0.18 + 0.5 * ((band + 1) / BANDS)
}

function thresholds(scaleMode: ScaleMode, max: number) {
  if (scaleMode === 'fibonacci') {
    return [0, 0.236, 0.382, 0.618, 1].map((ratio) => ratio * max)
  }
  return Array.from({ length: BANDS + 1 }, (_, i) => (i / BANDS) * max)
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
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
  selectedRange,
  onRangeChange,
  hoverFrac,
  onHoverChange,
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
  const nearestPoint = (frac: number) => {
    let best = pts[0]
    let bestDist = Infinity
    for (const p of pts) {
      const x = xDomainMode === 'local' ? p.localXf : p.xf
      const dist = Math.abs(x - frac)
      if (dist < bestDist) {
        bestDist = dist
        best = p
      }
    }
    return best
  }

  const rangeReadout = useMemo(() => {
    if (!selectedRange || !hasData) return null
    const startFrac = Math.min(selectedRange.start, selectedRange.end)
    const endFrac = Math.max(selectedRange.start, selectedRange.end)
    const startPoint = nearestPoint(startFrac)
    const endPoint = nearestPoint(endFrac)
    if (!startPoint?.close || !endPoint?.close) return null
    return ((endPoint.close - startPoint.close) / startPoint.close) * 100
  }, [selectedRange, hasData, pts, xDomainMode])

  const active = useMemo(() => {
    if (hoverFrac == null || !hasData) return null
    return nearestPoint(hoverFrac)
  }, [hoverFrac, hasData, pts, xDomainMode])
  const shown = active ?? (hasData ? pts[pts.length - 1] : null)
  const displayValue = rangeReadout ?? shown?.v ?? 0
  const displayClass = displayValue >= 0 ? 'pos' : 'neg'
  const rangeStart = selectedRange ? Math.min(selectedRange.start, selectedRange.end) : null
  const rangeEnd = selectedRange ? Math.max(selectedRange.start, selectedRange.end) : null
  const rangeWidth = rangeStart != null && rangeEnd != null ? Math.max(1, (rangeEnd - rangeStart) * width) : 0

  const dragState = useRef<DragState | null>(null)
  const fracFromEvent = (e: React.PointerEvent) => {
    if (!hasData) return
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    return clamp01((e.clientX - rect.left) / rect.width)
  }

  const beginRange = (e: React.PointerEvent<HTMLDivElement>) => {
    const frac = fracFromEvent(e)
    if (frac == null) return
    onHoverChange(null)
    if (rangeStart != null && rangeEnd != null && frac >= rangeStart && frac <= rangeEnd) {
      dragState.current = {
        mode: 'move',
        pointerStart: frac,
        rangeStart,
        rangeEnd,
      }
    } else {
      dragState.current = { mode: 'create', start: frac }
      onRangeChange({ start: frac, end: frac })
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const updateRange = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    const frac = fracFromEvent(e)
    if (frac == null) return
    if (!state) {
      if (e.pointerType === 'mouse') onHoverChange(frac)
      return
    }
    if (state.mode === 'create') {
      if (Math.abs(frac - state.start) >= MIN_RANGE_FRACTION) {
        onRangeChange({ start: state.start, end: frac })
      } else {
        onRangeChange(null)
      }
      return
    }

    const span = state.rangeEnd - state.rangeStart
    const nextStart = clamp01(state.rangeStart + frac - state.pointerStart)
    const clampedStart = Math.min(Math.max(0, nextStart), 1 - span)
    onRangeChange({ start: clampedStart, end: clampedStart + span })
  }

  const finishRange = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragState.current
    dragState.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (!state) return
    const end = fracFromEvent(e)
    if (state.mode === 'move') return
    if (end == null || Math.abs(end - state.start) < MIN_RANGE_FRACTION) {
      onRangeChange(null)
      return
    }
    onRangeChange({ start: state.start, end })
  }

  return (
    <div className="row">
      <span className="row-sym">{symbol}</span>
      <div
        ref={stripRef}
        className={`strip${selectedRange ? ' strip-has-range' : ''}`}
        onPointerDown={beginRange}
        onPointerMove={updateRange}
        onPointerUp={finishRange}
        onPointerCancel={() => {
          const state = dragState.current
          dragState.current = null
          if (state?.mode === 'create') onRangeChange(null)
          onHoverChange(null)
        }}
        onPointerLeave={() => {
          if (!dragState.current) onHoverChange(null)
        }}
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
            {rangeStart != null && rangeEnd != null && (
              <>
                <rect
                  className="range-selection"
                  x={rangeStart * width}
                  y={0}
                  width={rangeWidth}
                  height={H}
                />
                <line
                  className="range-edge"
                  x1={rangeStart * width}
                  x2={rangeStart * width}
                  y1={0}
                  y2={H}
                />
                <line
                  className="range-edge"
                  x1={rangeEnd * width}
                  x2={rangeEnd * width}
                  y1={0}
                  y2={H}
                />
              </>
            )}
            {hoverFrac != null && (
              <line
                className="hover-marker"
                x1={hoverFrac * width}
                x2={hoverFrac * width}
                y1={0}
                y2={H}
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
        <span className={`row-pct ${displayClass}`}>
          <AnimatedNumber value={displayValue} formatter={fmtPct} />
          {rangeReadout != null ? (
            <small>range</small>
          ) : active ? (
            <AnimatedNumber value={active.close} formatter={fmtMoney} className="row-price" />
          ) : null}
        </span>
      ) : (
        <span className="row-pct">—</span>
      )}
    </div>
  )
})
