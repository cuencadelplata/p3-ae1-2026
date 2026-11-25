import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, getToken, hayVueltaPendiente, volverALaApp } from '../api';
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
  if (!getToken()) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const customer = await api.createCustomer({
        preferences: { preferredVehicleType, notificationChannel },
      });
      // Si vino derivado desde la app, vuelve ahí con el perfil ya creado.
      if (volverALaApp()) return;
      navigate(`/customers/${customer.customerId}`, { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
      setSubmitting(false);
    }
  }

  return (
    <div className="narrow">
      <h1 className="page-title">Completá tu perfil</h1>
      <p className="page-lead">
        Tu identidad ya está verificada por M1. Elegí tus preferencias para terminar de crear tu perfil.
        {hayVueltaPendiente() && ' Después volvés a la app para pedir tu viaje.'}
      </p>

      <div className="card">
        <form onSubmit={handleSubmit} className="stack">
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
            <button type="submit" disabled={submitting} className="btn-primary">
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
    <label className="field">
      {label}
      {children}
    </label>
  );
}
