import { useState } from 'react';
import { api } from '../api';
import type { CustomerProfile, Preferences } from '../types';

interface Props {
  customer: CustomerProfile;
  onUpdate: (c: CustomerProfile) => void;
}

export default function PreferencesEditor({ customer, onUpdate }: Props) {
  const [prefs, setPrefs] = useState<Preferences>({ ...customer.preferences });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [error, setError]   = useState('');

  const dirty =
    prefs.preferredVehicleType !== customer.preferences.preferredVehicleType ||
    prefs.notificationChannel  !== customer.preferences.notificationChannel;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSaved(false);
    setPrefs(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const updated = await api.updatePreferences(customer.customerId, prefs);
      onUpdate(updated);
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 style={sectionTitle}>Preferences</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <label style={labelStyle}>
          Preferred vehicle
          <select name="preferredVehicleType" value={prefs.preferredVehicleType} onChange={handleChange}>
            <option value="auto">Auto</option>
            <option value="moto">Moto</option>
          </select>
        </label>
        <label style={labelStyle}>
          Notification channel
          <select name="notificationChannel" value={prefs.notificationChannel} onChange={handleChange}>
            <option value="email">Email</option>
            <option value="push">Push</option>
          </select>
        </label>

        {error && <p className="error-msg">{error}</p>}
        {saved && <p style={{ color: '#166534', fontSize: '0.85rem' }}>✓ Saved</p>}

        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{ background: '#6366f1', color: '#fff', alignSelf: 'flex-start' }}
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = { fontSize: '0.95rem', fontWeight: 600, marginBottom: '16px', color: '#374151' };
const labelStyle: React.CSSProperties   = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.875rem', fontWeight: 500 };
