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
      // El PUT devuelve solo customerId, preferences y status: se combina con el perfil actual
      // para no perder userId ni createdAt
      onUpdate({ ...customer, ...updated });
      setSaved(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2 className="section-title">Preferences</h2>
      <div className="stack">
        <label className="field">
          Preferred vehicle
          <select name="preferredVehicleType" value={prefs.preferredVehicleType} onChange={handleChange}>
            <option value="auto">Auto</option>
            <option value="moto">Moto</option>
          </select>
        </label>
        <label className="field">
          Notification channel
          <select name="notificationChannel" value={prefs.notificationChannel} onChange={handleChange}>
            <option value="email">Email</option>
            <option value="push">Push</option>
          </select>
        </label>

        {error && <p className="error-msg">{error}</p>}
        {saved && <p className="success-msg">✓ Saved</p>}

        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="btn-primary"
          style={{ alignSelf: 'flex-start' }}
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}
