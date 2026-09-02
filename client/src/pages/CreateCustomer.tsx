import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

export default function CreateCustomer() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    preferredVehicleType: 'auto' as 'auto' | 'moto',
    notificationChannel: 'email' as 'email' | 'push',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const customer = await api.createCustomer({
        name: form.name,
        email: form.email,
        phone: form.phone,
        preferences: {
          preferredVehicleType: form.preferredVehicleType,
          notificationChannel: form.notificationChannel,
        },
      });
      navigate(`/customers/${customer.customerId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: '24px', fontSize: '1.4rem' }}>New Customer</h1>
      <div className="card" style={{ maxWidth: '480px' }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Name">
            <input name="name" value={form.name} onChange={handleChange} placeholder="Jane Doe" required minLength={2} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="jane@example.com" required />
          </Field>
          <Field label="Phone">
            <input name="phone" value={form.phone} onChange={handleChange} placeholder="+5493512345678" required minLength={6} />
          </Field>
          <Field label="Preferred vehicle">
            <select name="preferredVehicleType" value={form.preferredVehicleType} onChange={handleChange}>
              <option value="auto">Auto</option>
              <option value="moto">Moto</option>
            </select>
          </Field>
          <Field label="Notification channel">
            <select name="notificationChannel" value={form.notificationChannel} onChange={handleChange}>
              <option value="email">Email</option>
              <option value="push">Push</option>
            </select>
          </Field>

          {error && <p className="error-msg">{error}</p>}

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <button type="submit" disabled={submitting} style={{ background: '#6366f1', color: '#fff' }}>
              {submitting ? 'Creating…' : 'Create Customer'}
            </button>
            <button type="button" onClick={() => navigate('/')} style={{ background: '#f3f4f6', color: '#374151' }}>
              Cancel
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
