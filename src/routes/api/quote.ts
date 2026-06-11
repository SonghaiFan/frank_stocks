import { createFileRoute } from '@tanstack/react-router'
import { getQuotesFromQuery } from '~/lib/stocks'

export const Route = createFileRoute('/api/quote')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        return Response.json(await getQuotesFromQuery(request.url))
      },
    },
  },
})
