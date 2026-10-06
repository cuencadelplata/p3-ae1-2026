import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { initTokenFromUrl, resolverMiPerfil, prepararPerfilDePrueba, getToken } from '../api';

/**
 * Index del front.
 *
 * FLUJO REAL (producción): M1 redirige al usuario con el token en la URL (?token=<jwt>).
 *   - Si ya hay perfil → va directo a su detalle.
 *   - Si no hay perfil → va al alta de preferencias (/onboarding).
 *
 * FLUJO DEMO (sin integración real todavía): dos botones que generan un token de prueba
 *   contra el stub de M1 y abren un perfil de ejemplo.
 */

const ESCENARIOS = {
  habilitado:   { userId: 12, label: 'Perfil habilitado' },
  inhabilitado: { userId: 14, label: 'Perfil inhabilitado' },
} as const;

type EscenarioKey = keyof typeof ESCENARIOS;

export default function Home() {
  const navigate = useNavigate();
  const [resolviendo, setResolviendo] = useState(true);
  const [loadingDemo, setLoadingDemo] = useState<EscenarioKey | null>(null);
  const [error, setError] = useState('');

  // Al montar: si llegó un token (por URL o sesión previa), resolver el perfil del flujo real.
  useEffect(() => {
    const vieneDeUrl = initTokenFromUrl();
    const hayToken = getToken() !== null;

    if (!vieneDeUrl && !hayToken) {
      // Sin token → mostrar solo la sección de demo
      setResolviendo(false);
      return;
    }

    resolverMiPerfil()
      .then(({ profile }) => {
        if (profile) {
          navigate(`/customers/${profile.customerId}`, { replace: true });
        } else {
          navigate('/onboarding', { replace: true }); // 404 → completar perfil
        }
      })
      .catch((e: Error) => {
        setError(e.message);
        setResolviendo(false);
      });
  }, [navigate]);

  async function abrirDemo(key: EscenarioKey) {
    setError('');
    setLoadingDemo(key);
    try {
      const perfil = await prepararPerfilDePrueba(ESCENARIOS[key].userId);
      navigate(`/customers/${perfil.customerId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado al preparar el perfil');
      setLoadingDemo(null);
    }
  }

  if (resolviendo) {
    return <p className="loading" style={{ textAlign: 'center' }}>Resolviendo tu perfil…</p>;
  }

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: '8px' }}>M2 · Perfil de Cliente</h1>
      <p style={{ color: '#6b7280', marginBottom: '40px', fontSize: '0.95rem' }}>
        En el flujo real, M1 te redirige con tu token y vas directo a tu perfil.
        Como todavía no integramos con los demás módulos, usá los escenarios de prueba.
      </p>

      <div style={demoBoxStyle}>
        <span style={demoLabelStyle}>Modo demostración</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '16px' }}>
          <ScenarioCard
            title="Perfil habilitado"
            description="Usuario sin penalizaciones. Su estado de cuenta se mantiene ACTIVO."
            accent="#166534"
            background="#f0fdf4"
            loading={loadingDemo === 'habilitado'}
            disabled={loadingDemo !== null}
            onClick={() => abrirDemo('habilitado')}
          />
          <ScenarioCard
            title="Perfil inhabilitado"
            description="Usuario con penalizaciones vigentes. Al consultar su estado queda BLOQUEADO."
            accent="#991b1b"
            background="#fef2f2"
            loading={loadingDemo === 'inhabilitado'}
            disabled={loadingDemo !== null}
            onClick={() => abrirDemo('inhabilitado')}
          />
        </div>
      </div>

      {error && <p className="error-msg" style={{ marginTop: '24px' }}>{error}</p>}
    </div>
  );
}

interface ScenarioCardProps {
  title: string;
  description: string;
  accent: string;
  background: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ScenarioCard({ title, description, accent, background, loading, disabled, onClick }: ScenarioCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '28px 24px',
        borderRadius: '12px',
        border: `1px solid ${accent}22`,
        background,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: 'left',
        transition: 'transform 0.1s, box-shadow 0.1s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      }}
    >
      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: accent }}>{title}</span>
      <span style={{ fontSize: '0.85rem', color: '#4b5563', lineHeight: 1.4 }}>{description}</span>
      <span style={{ marginTop: '8px', fontSize: '0.85rem', fontWeight: 600, color: accent }}>
        {loading ? 'Preparando…' : 'Abrir perfil →'}
      </span>
    </button>
  );
}

const demoBoxStyle: React.CSSProperties = {
  border: '1px dashed #d1d5db',
  borderRadius: '14px',
  padding: '24px',
  position: 'relative',
};
const demoLabelStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#9ca3af',
};
