import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: LegacyStockInterface,
})

function LegacyStockInterface() {
  return (
    <iframe
      className="legacy-stock-frame"
      src="/legacy.html"
      title="Speleothems Charts"
    />
  )
}
