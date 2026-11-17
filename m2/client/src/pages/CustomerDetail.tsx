import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import type { CustomerProfile, AccountStatusResponse, CustomerTripsResponse } from '../types';
import { statusBadge, formatDate } from '../utils';
import PreferencesEditor from '../components/PreferencesEditor';

type Tab = 'profile' | 'status' | 'trips';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [status, setStatus]     = useState<AccountStatusResponse | null>(null);
  const [trips, setTrips]       = useState<CustomerTripsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.getCustomer(id)
      .then(setCustomer)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id || activeTab === 'profile') return;
    if (activeTab === 'status' && !status) {
      api.getAccountStatus(id).then(setStatus).catch(() => null);
    }
    if (activeTab === 'trips' && !trips) {
      api.getTrips(id).then(setTrips).catch(() => null);
    }
  }, [activeTab, id, status, trips]);

  if (loading) return <p className="loading">Cargando…</p>;
  if (error)   return <p className="error-msg">Error: {error}</p>;
  if (!customer) return null;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <Link to="/" className="back-link">← Inicio</Link>
        <h1>
          {customer.identity ? `${customer.identity.nombre} ${customer.identity.apellido}` : `Usuario #${customer.userId}`}
        </h1>
        <span className={`badge ${statusBadge(customer.status)}`}>{customer.status}</span>
      </div>

      {/* Tabs */}
      <div className="tabs">
        {([['profile', 'Perfil'], ['status', 'Estado de cuenta'], ['trips', 'Viajes']] as [Tab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`tab${activeTab === tab ? ' active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'profile' && (
        <ProfileTab customer={customer} onUpdate={setCustomer} />
      )}
      {activeTab === 'status' && (
        <StatusTab data={status} />
      )}
      {activeTab === 'trips' && (
        <TripsTab data={trips} />
      )}
    </div>
  );
}

/* ── Profile tab ── */
function ProfileTab({ customer, onUpdate }: { customer: CustomerProfile; onUpdate: (c: CustomerProfile) => void }) {
  return (
    <div className="grid-2">
      <div className="card">
        <h2 className="section-title">Identidad</h2>
        <dl className="kv">
          <dt>Customer ID</dt>
          <dd><code>{customer.customerId}</code></dd>
          <dt>User ID (M1)</dt>
          <dd>{customer.userId}</dd>
          <dt>Alta</dt>
          <dd>{formatDate(customer.createdAt)}</dd>
        </dl>

        <h2 className="section-title">Datos personales</h2>
        {customer.identity ? (
          <dl className="kv">
            <dt>Nombre</dt>
            <dd>{customer.identity.nombre} {customer.identity.apellido}</dd>
            <dt>Email</dt>
            <dd>{customer.identity.email}</dd>
            <dt>Teléfono</dt>
            <dd>{customer.identity.telefono ?? '—'}</dd>
            <dt>DNI</dt>
            <dd>{customer.identity.dni ?? '—'}</dd>
            <dt>Estado en M1</dt>
            <dd>{customer.identity.estado}</dd>
          </dl>
        ) : (
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            No se pudieron obtener los datos personales desde M1.
          </p>
        )}
        <p className="note">
          Los datos personales pertenecen a M1 y se consultan en el momento; M2 solo guarda el vínculo por <code>userId</code> y las preferencias.
        </p>
      </div>
      <PreferencesEditor customer={customer} onUpdate={onUpdate} />
    </div>
  );
}

/* ── Status tab ── */
function StatusTab({ data }: { data: AccountStatusResponse | null }) {
  if (!data) return <p className="loading">Cargando estado…</p>;
  return (
    <div className="card" style={{ maxWidth: '520px' }}>
      <h2 className="section-title">Estado de cuenta</h2>
      <dl className="kv">
        <dt>Estado</dt>
        <dd><span className={`badge ${statusBadge(data.status)}`}>{data.status}</span></dd>
        <dt>Motivo</dt>
        <dd>{data.reason}</dd>
        {data.blockOrigin && (
          <>
            <dt>Origen</dt>
            <dd>{data.blockOrigin === 'AUTOMATICO' ? 'Automático (penalizaciones)' : 'Manual'}</dd>
          </>
        )}
        <dt>Actualizado</dt>
        <dd>{formatDate(data.updatedAt)}</dd>
      </dl>
      <p className="note">
        El estado se recalcula en cada consulta con las penalizaciones vigentes de Soporte.
      </p>
    </div>
  );
}

/* ── Trips tab ── */
function TripsTab({ data }: { data: CustomerTripsResponse | null }) {
  if (!data) return <p className="loading">Cargando viajes…</p>;
  if (data.degraded) return <p className="error-msg">No se pudo cargar el historial.</p>;
  if (data.trips.length === 0) return <p className="loading">No se encontraron viajes.</p>;
  return (
    <div>
      <p className="muted" style={{ marginBottom: '16px', fontSize: '0.875rem' }}>
        {data.tripsCount} viaje{data.tripsCount !== 1 ? 's' : ''} (datos de M6)
      </p>
      <div className="trip-list">
        {data.trips.map(t => (
          <div key={t.tripId} className="card trip">
            <div>
              <p className="trip-route">{t.origin} → {t.destination}</p>
              <p className="trip-meta">
                {formatDate(t.createdAt)} · <code>{t.tripId}</code>
              </p>
            </div>
            <div className="trip-side">
              <p className={`trip-fare${t.fare === null ? ' empty' : ''}`}>
                {t.fare === null ? '—' : `$${t.fare.toLocaleString()}`}
              </p>
              <span className={`badge ${t.status === 'COMPLETADO' ? 'badge-activo' : 'badge-revision'}`}>
                {t.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
