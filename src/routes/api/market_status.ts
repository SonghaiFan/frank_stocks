import { createFileRoute } from '@tanstack/react-router'
import { getMarketStatus } from '~/lib/stocks'

export const Route = createFileRoute('/api/market_status')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(getMarketStatus())
      },
    },
  },
})
