import { createFileRoute } from '@tanstack/react-router'
import { removeSymbol } from '~/lib/stocks'

export const Route = createFileRoute('/api/watchlist/$symbol')({
  server: {
    handlers: {
      DELETE: async ({ params }) => {
        return Response.json(await removeSymbol(params.symbol))
      },
    },
  },
})
