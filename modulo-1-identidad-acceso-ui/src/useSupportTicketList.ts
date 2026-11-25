import { useEffect, useState } from 'react'
import { requestWithHeaders } from './rideFlowApi'
import type { SupportTicket, TicketOrder, TicketStatus } from './supportTickets'

type Result =
  | { key: string; tickets: SupportTicket[]; next: string | null; error?: undefined }
  | { key: string; error: string; tickets?: undefined; next?: undefined }

export function useSupportTicketList(token: string, path: string | null, initialStatus: TicketStatus | '' = '', tripId?: string) {
  const [status, setStatus] = useState(initialStatus)
  const [order, setOrder] = useState<TicketOrder>('desc')
  const [cursor, setCursor] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<Result>()
  const query = new URLSearchParams({ limit: '20', orden: order })
  if (tripId) query.set('tripId', tripId)
  if (status) query.set('estado', status)
  if (cursor) query.set('cursor', cursor)
  const url = path ? path + '?' + query : null
  const key = JSON.stringify([url, revision])
  const current = result?.key === key ? result : undefined

  useEffect(() => {
    if (!url) return
    const abort = new AbortController()
    requestWithHeaders<SupportTicket[]>('M8', url, { token, signal: abort.signal })
      .then(({ data, headers }) => {
        if (!abort.signal.aborted) setResult({ key, tickets: data, next: headers.get('X-Next-Cursor') })
      })
      .catch((error: Error) => {
        if (!abort.signal.aborted) setResult({ key, error: error.message })
      })
    return () => abort.abort()
  }, [key, token, url])

  function refresh() { setRevision(value => value + 1) }
  return {
    tickets: current?.tickets ?? [],
    loading: Boolean(url && !current),
    error: current?.error,
    hasNext: Boolean(current?.next),
    hasPrevious: Boolean(cursor),
    filters: {
      status, order,
      onStatus(value: TicketStatus | '') { setStatus(value); setCursor(null); refresh() },
      onOrder(value: TicketOrder) { setOrder(value); setCursor(null); refresh() },
    },
    first() { setCursor(null); refresh() },
    next() { if (current?.next) { setCursor(current.next); refresh() } },
    refresh,
  }
}
