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

  if (loading) return <p className="loading">Loading…</p>;
  if (error)   return <p className="error-msg">Error: {error}</p>;
  if (!customer) return null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <Link to="/" style={{ color: '#6366f1', fontSize: '0.875rem' }}>← Customers</Link>
        <span style={{ color: '#d1d5db' }}>|</span>
        <h1 style={{ fontSize: '1.3rem' }}>{customer.name}</h1>
        <span className={`badge ${statusBadge(customer.status)}`}>{customer.status}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', borderBottom: '1px solid #e5e7eb' }}>
        {(['profile', 'status', 'trips'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'none',
              borderRadius: '6px 6px 0 0',
              padding: '8px 20px',
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? '#6366f1' : '#6b7280',
              borderBottom: activeTab === tab ? '2px solid #6366f1' : '2px solid transparent',
            }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
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
    <div style={{ display: 'grid', gap: '20px', gridTemplateColumns: '1fr 1fr' }}>
      <div className="card">
        <h2 style={sectionTitle}>Contact</h2>
        <dl style={dlStyle}>
          <dt style={dtStyle}>ID</dt>
          <dd><code style={{ fontSize: '0.8rem' }}>{customer.customerId}</code></dd>
          <dt style={dtStyle}>Email</dt>
          <dd>{customer.email}</dd>
          <dt style={dtStyle}>Phone</dt>
          <dd>{customer.phone}</dd>
          <dt style={dtStyle}>Member since</dt>
          <dd>{formatDate(customer.createdAt)}</dd>
        </dl>
      </div>
      <PreferencesEditor customer={customer} onUpdate={onUpdate} />
    </div>
  );
}

/* ── Status tab ── */
function StatusTab({ data }: { data: AccountStatusResponse | null }) {
  if (!data) return <p className="loading">Loading status…</p>;
  return (
    <div className="card" style={{ maxWidth: '480px' }}>
      <h2 style={sectionTitle}>Account Status</h2>
      <dl style={dlStyle}>
        <dt style={dtStyle}>Status</dt>
        <dd><span className={`badge ${statusBadge(data.status)}`}>{data.status}</span></dd>
        <dt style={dtStyle}>Reason</dt>
        <dd>{data.reason}</dd>
        <dt style={dtStyle}>Last updated</dt>
        <dd>{formatDate(data.updatedAt)}</dd>
      </dl>
    </div>
  );
}

/* ── Trips tab ── */
function TripsTab({ data }: { data: CustomerTripsResponse | null }) {
  if (!data) return <p className="loading">Loading trips…</p>;
  if (data.trips.length === 0) return <p className="loading">No trips found.</p>;
  return (
    <div>
      <p style={{ marginBottom: '16px', color: '#6b7280', fontSize: '0.875rem' }}>
        {data.tripsCount} trip{data.tripsCount !== 1 ? 's' : ''} found
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {data.trips.map(t => (
          <div key={t.tripId} className="card" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
            <div>
              <p style={{ fontWeight: 500, marginBottom: '4px' }}>
                {t.origin} → {t.destination}
              </p>
              <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                {formatDate(t.createdAt)} · <code style={{ fontSize: '0.75rem' }}>{t.tripId}</code>
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontWeight: 600, color: '#111827' }}>${t.fare.toLocaleString()}</p>
              <span style={{
                fontSize: '0.75rem',
                color: t.status === 'COMPLETADO' ? '#166534' : '#854d0e',
                fontWeight: 500,
              }}>
                {t.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: '0.95rem', fontWeight: 600, marginBottom: '16px', color: '#374151' };
const dlStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '10px', alignItems: 'start' };
const dtStyle: React.CSSProperties = { fontSize: '0.8rem', color: '#9ca3af', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: '2px' };
