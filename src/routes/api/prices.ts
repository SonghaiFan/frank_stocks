import { createFileRoute } from '@tanstack/react-router'
import { getPricesFromQuery } from '~/lib/stocks'

export const Route = createFileRoute('/api/prices')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return Response.json(await getPricesFromQuery(request.url))
      },
    },
  },
})
