import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'

export default function TripClock({ startedAt, endedAt }: { startedAt?: string | null; endedAt?: string | null }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!startedAt || endedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt, endedAt])
  const start = startedAt ? Date.parse(startedAt) : NaN
  const end = endedAt ? Date.parse(endedAt) : now
  const seconds = Math.max(0, Math.floor((end - start) / 1000))
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
  return <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] p-3">
    <Clock3 className="text-[var(--accent)]" size={18} aria-hidden="true" />
    <span>{endedAt ? 'Duración del viaje' : 'Tiempo de viaje'}</span>
    <strong className="tabular-nums text-[var(--accent)]" role="timer">{Number.isFinite(seconds) ? parts.map((part) => String(part).padStart(2, '0')).join(':') : '—'}</strong>
  </div>
}
