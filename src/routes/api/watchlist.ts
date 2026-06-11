import { createFileRoute } from '@tanstack/react-router'
import { addSymbol, loadWatchlist } from '~/lib/stocks'

export const Route = createFileRoute('/api/watchlist')({
  server: {
    handlers: {
      GET: async () => {
        return Response.json(await loadWatchlist())
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}))
        return addSymbol(String(body.symbol || ''), String(body.sector || 'AI Models'))
      },
    },
  },
})
