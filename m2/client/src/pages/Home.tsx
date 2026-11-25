import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { initTokenFromUrl, initVolverFromUrl, volverALaApp, resolverMiPerfil, prepararPerfilDePrueba, getToken } from '../api';

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
    initVolverFromUrl();
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
          // Ya tiene perfil: si vino derivado desde la app, vuelve ahí.
          if (volverALaApp()) return;
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
    <div className="hero">
      <h1>M2 · <span className="accent">Perfil de Cliente</span></h1>
      <p className="hero-lead">
        En el flujo real, M1 te redirige con tu token y vas directo a tu perfil.
        Como todavía no integramos con los demás módulos, usá los escenarios de prueba.
      </p>

      <div className="demo-box">
        <span className="eyebrow">Modo demostración</span>
        <div className="scenarios">
          <ScenarioCard
            title="Perfil habilitado"
            description="Usuario sin penalizaciones. Su estado de cuenta se mantiene ACTIVO."
            variant="ok"
            loading={loadingDemo === 'habilitado'}
            disabled={loadingDemo !== null}
            onClick={() => abrirDemo('habilitado')}
          />
          <ScenarioCard
            title="Perfil inhabilitado"
            description="Usuario con penalizaciones vigentes. Al consultar su estado queda BLOQUEADO."
            variant="danger"
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
  variant: 'ok' | 'danger';
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}

function ScenarioCard({ title, description, variant, loading, disabled, onClick }: ScenarioCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`scenario scenario-${variant}`}
      style={loading ? { opacity: 1 } : undefined}
    >
      <span className="scenario-title">{title}</span>
      <span className="scenario-desc">{description}</span>
      <span className="scenario-cta">{loading ? 'Preparando…' : 'Abrir perfil →'}</span>
    </button>
  );
}
