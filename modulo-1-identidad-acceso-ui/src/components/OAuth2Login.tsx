import { useEffect, useState } from 'react'
import axios from 'axios'
import { LogIn } from 'lucide-react'
import { API_URL } from '../api'

// RF-1.5 (Maxi): ingreso con un proveedor externo por OAuth2 / OpenID Connect.
// Respuesta de GET /auth/oauth2/providers.
interface Proveedor {
  provider: string
  configured: boolean
  isDefault: boolean
  description: string
}

const NOMBRES: Record<string, string> = {
  GOOGLE: 'Google',
  AUTH0: 'Auth0',
}

const LOGOS: Record<string, string> = {
  GOOGLE: '/logos/google.jpg',
  AUTH0: '/logos/auth0.png',
}

// Google y Auth0 vuelven a la raíz de la interfaz (http://localhost:5173/).
// Esa dirección tiene que estar registrada en cada proveedor como URL de retorno permitida.
// El proveedor elegido se guarda antes de salir, porque la URL de retorno no lo trae.
const CLAVE_PROVEEDOR = 'm1_oauth_provider'

export function redirectUriOAuth2(): string {
  return `${window.location.origin}/`
}

export function proveedorPendiente(): string | null {
  try {
    const provider = sessionStorage.getItem(CLAVE_PROVEEDOR)
    sessionStorage.removeItem(CLAVE_PROVEEDOR)
    return provider
  } catch {
    return null
  }
}

// Paso final: M1 cambia el code por un token del proveedor y emite su propio JWT.
export async function completarOAuth2(
  provider: string,
  code: string,
  state: string,
  redirectUri?: string
): Promise<string> {
  const { data } = await axios.post(`${API_URL}/auth/oauth2/callback`, {
    provider,
    code,
    state,
    redirect_uri: redirectUri,
  })
  return data.token as string
}

export default function OAuth2Login() {
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [ingresando, setIngresando] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    axios
      .get<{ providers: Proveedor[] }>(`${API_URL}/auth/oauth2/providers`)
      .then(({ data }) => setProveedores(data.providers.filter(({ provider, configured }) => configured && (provider === 'GOOGLE' || provider === 'AUTH0'))))
      .catch(() => setProveedores([]))
  }, [])

  const ingresar = async (provider: string) => {
    setError('')
    setIngresando(provider)
    try {
      // Google y Auth0: M1 redirige al proveedor, que después vuelve a esta página con code y state.
      try {
        sessionStorage.setItem(CLAVE_PROVEEDOR, provider)
      } catch {
        /* sin sessionStorage no se puede completar la vuelta */
      }
      const params = new URLSearchParams({
        provider,
        redirect: 'true',
        redirect_uri: redirectUriOAuth2(),
      })
      window.location.href = `${API_URL}/auth/oauth2/authorize?${params.toString()}`
    } catch (err: any) {
      setError(err.response?.data?.error || 'No se pudo ingresar con el proveedor')
      setIngresando('')
    }
  }

  if (proveedores.length === 0) return null

  return (
    <div>
      <p className="field-label text-center">O ingresá con</p>
      {error && <div className="alert-error mb-4 text-sm">{error}</div>}
      <div className="space-y-3">
        {proveedores.map((p) => (
          <button
            key={p.provider}
            type="button"
            onClick={() => ingresar(p.provider)}
            disabled={!p.configured || ingresando !== ''}
            className="btn-secondary relative flex items-center justify-center gap-2 px-4 py-3.5"
            title={p.configured ? p.description : 'No configurado en este entorno'}
          >
            <LogIn className="w-4 h-4 text-[var(--text-dim)]" />
            <span className="font-medium text-sm">
              {ingresando === p.provider
                ? 'Conectando…'
                : `${NOMBRES[p.provider] ?? p.provider}${p.configured ? '' : ' (no configurado)'}`}
            </span>

            {/* Logo a la derecha */}
            {LOGOS[p.provider] && (
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center justify-center bg-white px-2 py-0.5 rounded-md shadow-sm">
                <img
                  src={LOGOS[p.provider]}
                  alt={NOMBRES[p.provider]}
                  className="h-4.5 w-auto max-w-[65px] object-contain"
                />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-3 text-center font-mono text-[10px] text-[var(--text-dim)]">RF-1.5 · OAuth2 / OpenID Connect</p>
    </div>
  )
}
