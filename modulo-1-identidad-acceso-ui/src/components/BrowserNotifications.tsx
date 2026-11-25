import { useEffect, useState } from 'react'
import { Bell, ChevronDown, ChevronUp } from 'lucide-react'
import { ensurePassenger, FlowError, request } from '../rideFlowApi'

interface Customer {
  customerId: string
  preferences: { preferredVehicleType: string; notificationChannel: string }
}

const scope = '/push'

interface Notice {
  id: string
  title: string
  message: string
  createdAt: string
}

function RecentNotifications({ token }: { token: string }) {
  const [notices, setNotices] = useState<Notice[] | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const abort = new AbortController()
    let timer: number
    async function refresh() {
      if (document.visibilityState === 'visible') {
        try {
          const { data } = await request<{ data: Notice[] }>('M8', '/notifications/me', { token, signal: abort.signal })
          if (!abort.signal.aborted) {
            setNotices(data)
            setUnavailable(false)
          }
        } catch {
          if (!abort.signal.aborted) setUnavailable(true)
        }
      }
      if (!abort.signal.aborted) timer = window.setTimeout(refresh, 10_000)
    }
    void refresh()
    return () => {
      abort.abort()
      window.clearTimeout(timer)
    }
  }, [token])

  return (
    <div className="mt-3" aria-live="polite">
      {unavailable && <p className="text-sm">No pudimos actualizar tus avisos. Se volverán a consultar automáticamente.</p>}
      {!unavailable && notices === null && <p className="text-sm">Cargando tus avisos…</p>}
      {notices?.length === 0 && <p className="text-sm">Todavía no tenés avisos.</p>}
      {notices && notices.length > 0 && <ul className="divide-y divide-[var(--line)]">
        {notices.map(notice => <li className="py-3" key={notice.id}>
          <p className="font-semibold">{notice.title}</p>
          <p className="mt-1 text-sm">{notice.message}</p>
          <time className="mt-1 text-xs" dateTime={notice.createdAt}>{new Date(notice.createdAt).toLocaleString('es-AR')}</time>
        </li>)}
      </ul>}
    </div>
  )
}

function subscriptionKey(key: string) {
  const value = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function activateWorker() {
  const registration = await navigator.serviceWorker.register('/push/app-sw.js', { scope })
  if (registration.active) return registration

  const worker = registration.installing ?? registration.waiting
  if (!worker) throw new Error('El navegador no pudo iniciar las notificaciones.')

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('El navegador tardó en iniciar las notificaciones.')), 12_000)
    function finish(error?: Error) {
      window.clearTimeout(timer)
      worker?.removeEventListener('statechange', check)
      if (error) reject(error)
      else resolve()
    }
    function check() {
      if (worker?.state === 'activated') finish()
      if (worker?.state === 'redundant') finish(new Error('El navegador no pudo iniciar las notificaciones.'))
    }
    worker.addEventListener('statechange', check)
    check()
  })
  return registration
}

async function enableCustomerPush(token: string) {
  await ensurePassenger(token)
  const customer = await request<Customer>('M2', '/v1/customers/me', { token })
  if (customer.preferences.notificationChannel === 'push') return
  await request('M2', '/v1/customers/' + encodeURIComponent(customer.customerId), {
    token, method: 'PUT', body: { preferences: { ...customer.preferences, notificationChannel: 'push' } },
  })
}

export default function BrowserNotifications({ token, role, userId }: { token: string; role: 'CLIENTE' | 'CONDUCTOR'; userId: number }) {
  const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const displayKey = `movilidad.avisos.minimizados.${userId}`
  const [expanded, setExpanded] = useState(() => localStorage.getItem(displayKey) !== 'true')
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(supported)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supported) return
    const abort = new AbortController()
    async function check() {
      try {
        const registration = await navigator.serviceWorker.getRegistration(scope)
        const subscription = await registration?.pushManager.getSubscription()
        if (!subscription || Notification.permission !== 'granted') return
        const { data } = await request<{ data: { token: string }[] }>('M8', '/devices/tokens', { token, signal: abort.signal })
        if (!abort.signal.aborted) setActive(data.some(device => device.token === JSON.stringify(subscription)))
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo consultar este navegador.')
      } finally {
        if (!abort.signal.aborted) setBusy(false)
      }
    }
    void check()
    return () => abort.abort()
  }, [token, supported])

  async function toggle() {
    setBusy(true)
    setError('')
    try {
      if (active) {
        const registration = await navigator.serviceWorker.getRegistration(scope)
        const subscription = await registration?.pushManager.getSubscription()
        if (subscription) {
          await request('M8', '/devices/tokens/deactivate', {
            token, method: 'POST', body: { token: JSON.stringify(subscription) },
          }).catch((cause: unknown) => {
            if (!(cause instanceof FlowError) || cause.status !== 404) throw cause
          })
          await subscription.unsubscribe()
        }
        setActive(false)
        return
      }
      if (await Notification.requestPermission() !== 'granted') {
        throw new Error('Permití las notificaciones en la configuración de este sitio y volvé a intentar.')
      }
      const { publicKey } = await request<{ publicKey: string | null }>('M8', '/push/config')
      if (!publicKey) throw new Error('Las notificaciones todavía no están habilitadas en este entorno.')
      const registration = await activateWorker()
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: subscriptionKey(publicKey),
      })
      if (role === 'CLIENTE') await enableCustomerPush(token)
      await request('M8', '/devices/tokens', {
        token, method: 'POST', body: { token: JSON.stringify(subscription), platform: 'WEB' },
      })
      setActive(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron actualizar los avisos.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="browser-notifications" className="detail-card mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="browser-notifications" className="flex items-center gap-2 font-semibold">
          <Bell className="h-4 w-4 text-[var(--gold)]" aria-hidden="true" /> Avisos del viaje
        </h2>
        <button type="button" className="btn-ghost inline-flex items-center gap-1" aria-expanded={expanded}
          aria-controls="browser-notifications-content" onClick={() => {
            setExpanded(!expanded)
            localStorage.setItem(displayKey, String(expanded))
          }}>
          {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          {expanded ? 'Minimizar avisos' : 'Mostrar avisos'}
        </button>
      </div>
      <div id="browser-notifications-content" hidden={!expanded}>
        <RecentNotifications token={token} />
        <details className="mt-4 border-t border-[var(--line)] pt-3">
          <summary className="cursor-pointer text-sm font-semibold">Avisos fuera de la aplicación</summary>
          <p className="mt-2 text-sm" role="status">
            {!supported ? 'Este navegador o sitio no admite notificaciones.' : busy ? 'Actualizando avisos…' : active
              ? 'Activadas en este navegador. Podés cerrar la pestaña.'
              : 'Activá los avisos para recibir actualizaciones de tus viajes.'}
          </p>
          {supported && <button className="btn-secondary mt-3" disabled={busy} onClick={() => void toggle()}>
            {active ? 'Desactivar en este navegador' : 'Activar avisos'}
          </button>}
          {error && <p className="alert-error mt-3" role="alert">{error}</p>}
        </details>
      </div>
    </section>
  )
}
