import { memo, useEffect, useRef, useState } from 'react'

type AnimatedNumberProps = {
  value: number
  formatter: (value: number) => string
  className?: string
}

const DURATION = 420

export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  formatter,
  className,
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value)
  const previousValue = useRef(value)

  useEffect(() => {
    const from = previousValue.current
    const to = value
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      previousValue.current = to
      setDisplayValue(to)
      return
    }
    if (Math.abs(from - to) < 0.0001) return

    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayValue(from + (to - from) * eased)
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        previousValue.current = to
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return <span className={className}>{formatter(displayValue)}</span>
})
