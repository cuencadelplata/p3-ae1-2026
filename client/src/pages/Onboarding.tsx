import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from '../api';
import type { VehicleType, NotificationChannel } from '../types';

/**
 * Alta de perfil (flujo real).
 * Se llega acá cuando el usuario tiene token válido pero todavía no tiene perfil
 * en M2 (GET /me devolvió 404). Solo se piden las preferencias:
 * el nombre, teléfono y correo son de M1 y el userId sale del token.
 */
export default function Onboarding() {
  const navigate = useNavigate();
  const [preferredVehicleType, setVehicle] = useState<VehicleType>('auto');
  const [notificationChannel, setChannel] = useState<NotificationChannel>('email');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sin token activo no se puede crear el perfil → volver al index.
  if (!getToken()) {
    navigate('/', { replace: true });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const customer = await api.createCustomer({
        preferences: { preferredVehicleType, notificationChannel },
      });
      navigate(`/customers/${customer.customerId}`, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '8px' }}>Completá tu perfil</h1>
      <p style={{ color: '#6b7280', marginBottom: '24px', fontSize: '0.9rem' }}>
        Tu identidad ya está verificada por M1. Elegí tus preferencias para terminar de crear tu perfil.
      </p>

      <div className="card">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Vehículo preferido">
            <select value={preferredVehicleType} onChange={(e) => setVehicle(e.target.value as VehicleType)}>
              <option value="auto">Auto</option>
              <option value="moto">Moto</option>
            </select>
          </Field>
          <Field label="Canal de notificaciones">
            <select value={notificationChannel} onChange={(e) => setChannel(e.target.value as NotificationChannel)}>
              <option value="email">Email</option>
              <option value="push">Push</option>
            </select>
          </Field>

          {error && <p className="error-msg">{error}</p>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <button type="submit" disabled={submitting} style={{ background: '#6366f1', color: '#fff' }}>
              {submitting ? 'Creando…' : 'Crear perfil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.875rem', fontWeight: 500 }}>
      {label}
      {children}
    </label>
  );
}
