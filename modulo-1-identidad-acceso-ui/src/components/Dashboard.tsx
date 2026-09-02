import { LogOut, Mail, Shield, Fingerprint, Clock, Check } from 'lucide-react'

interface DashboardProps {
  user: any
  onLogout: () => void
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const roleLabel = (rol: string) => {
    const labels: { [key: string]: string } = {
      CLIENTE: 'Cliente',
      CONDUCTOR: 'Conductor',
      OPERADOR: 'Operador',
    }
    return labels[rol] || rol
  }

  const initials = (value: string) =>
    (value || '?').replace(/@.*/, '').slice(0, 2).toUpperCase()

  const email = user.email || user.sub || ''
  const role = user.rol || user.role || ''

  return (
    <div className="w-full max-w-3xl">
      <div className="glass rounded-[1.75rem] p-9 md:p-12">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="eyebrow">Panel</p>
            <h1 className="display text-[2.6rem] mt-3">Tu cuenta</h1>
          </div>
          <button onClick={onLogout} className="btn-ghost flex items-center gap-2 shrink-0">
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </button>
        </div>

        <div className="hairline my-9" />

        {/* Identidad */}
        <div className="flex items-center gap-5">
          <div className="h-16 w-16 rounded-full border border-[rgba(201,169,97,0.45)] flex items-center justify-center display text-xl text-[var(--gold)]">
            {initials(email)}
          </div>
          <div className="min-w-0">
            <p className="display text-2xl truncate">{email}</p>
            <div className="mt-2 flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-[var(--text-dim)]">
              <span className="inline-flex items-center gap-1.5 text-[var(--gold)]">
                <Check className="w-3.5 h-3.5" /> Sesión activa
              </span>
              <span>·</span>
              <span>{roleLabel(role)}</span>
            </div>
          </div>
        </div>

        {/* Detalles */}
        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="detail-card">
            <div className="flex items-center gap-2.5 mb-3">
              <Mail className="w-4 h-4 text-[var(--gold)]" />
              <span className="field-label !mb-0">Email</span>
            </div>
            <p className="font-mono text-sm break-all text-[var(--text)]">{email}</p>
          </div>

          <div className="detail-card">
            <div className="flex items-center gap-2.5 mb-3">
              <Shield className="w-4 h-4 text-[var(--gold)]" />
              <span className="field-label !mb-0">Rol</span>
            </div>
            <p className="text-sm tracking-[0.14em] uppercase">{roleLabel(role)}</p>
          </div>

          <div className="detail-card">
            <div className="flex items-center gap-2.5 mb-3">
              <Fingerprint className="w-4 h-4 text-[var(--gold)]" />
              <span className="field-label !mb-0">JWT ID</span>
            </div>
            <p className="font-mono text-xs break-all text-[var(--text-soft)]">{user.jti}</p>
          </div>

          <div className="detail-card">
            <div className="flex items-center gap-2.5 mb-3">
              <Clock className="w-4 h-4 text-[var(--gold)]" />
              <span className="field-label !mb-0">Emitido el</span>
            </div>
            <p className="font-mono text-sm text-[var(--text-soft)]">
              {new Date(user.iat * 1000).toLocaleString('es-AR')}
            </p>
          </div>
        </div>

        {/* Estado de sesión */}
        <div className="mt-8 rounded-2xl border border-[var(--line)] p-6">
          <p className="eyebrow mb-4">Estado de la sesión</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-[var(--text-soft)]">
            {[
              'Token JWT válido y activo',
              'Permiso de acceso confirmado',
              'Identidad y rol verificados',
              'Datos cifrados en tránsito',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-[var(--gold)] shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="hairline mt-10 mb-5" />
        <p className="text-center text-[11px] tracking-[0.22em] uppercase text-[var(--text-dim)]">
          API localhost:3001 · Docs /docs
        </p>
      </div>
    </div>
  )
}
