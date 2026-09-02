import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { CustomerProfile } from '../types';
import { statusBadge } from '../utils';

export default function CustomerList() {
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listCustomers()
      .then(setCustomers)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="loading">Loading customers…</p>;
  if (error)   return <p className="error-msg">Error: {error}</p>;

  return (
    <div>
      <h1 style={{ marginBottom: '20px', fontSize: '1.4rem' }}>Customers</h1>
      {customers.length === 0 ? (
        <p className="loading">No customers registered yet.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              {['ID', 'Name', 'Email', 'Phone', 'Status', ''].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.customerId} style={trStyle}>
                <td style={tdStyle}><code style={{ fontSize: '0.78rem' }}>{c.customerId}</code></td>
                <td style={tdStyle}>{c.name}</td>
                <td style={tdStyle}>{c.email}</td>
                <td style={tdStyle}>{c.phone}</td>
                <td style={tdStyle}>
                  <span className={`badge ${statusBadge(c.status)}`}>{c.status}</span>
                </td>
                <td style={tdStyle}>
                  <Link to={`/customers/${c.customerId}`} style={linkStyle}>
                    View →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#fff',
  borderRadius: '10px',
  overflow: 'hidden',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  background: '#f9fafb',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #e5e7eb',
};
const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: '0.875rem',
};
const trStyle: React.CSSProperties = { transition: 'background 0.1s' };
const linkStyle: React.CSSProperties = {
  color: '#6366f1',
  fontWeight: 500,
  fontSize: '0.85rem',
};
