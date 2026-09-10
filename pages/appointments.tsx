import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import styles from '../styles/Layout.module.css';
import type { Appointment, AppointmentSource, AppointmentStatus } from '../utils/types';

interface ListResponse {
  source: AppointmentSource;
  appointments: Appointment[];
  error?: string;
}

function toLocalInputValue(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string): string {
  return v ? new Date(v).toISOString() : '';
}

function formatDisplay(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const STATUSES: AppointmentStatus[] = ['Scheduled', 'Confirmed', 'Rescheduled', 'Cancelled'];

function statusClass(status: AppointmentStatus): string {
  switch (status) {
    case 'Confirmed':
      return styles.statusConfirmed;
    case 'Rescheduled':
      return styles.statusRescheduled;
    case 'Cancelled':
      return styles.statusCancelled;
    default:
      return styles.statusScheduled;
  }
}

function defaultTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toLocalInputValue(d.toISOString());
}

export default function AppointmentsPage() {
  const [source, setSource] = useState<AppointmentSource | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [form, setForm] = useState({
    customerName: '',
    phoneNumber: '',
    serviceType: 'Oil Change',
    appointmentTime: defaultTomorrow(),
    vehicle: '',
    location: 'Bay Area Honda Service Center',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/appointments');
      if (!res.ok) throw new Error(`GET /api/appointments returned ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setSource(data.source);
      setSourceError(data.error ?? null);
      setAppointments(data.appointments);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: form.customerName.trim(),
          phoneNumber: form.phoneNumber.trim(),
          serviceType: form.serviceType,
          appointmentTime: fromLocalInputValue(form.appointmentTime),
          status: 'Scheduled' as AppointmentStatus,
          vehicle: form.vehicle.trim() || undefined,
          location: form.location.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `POST returned ${res.status}`);
      }
      setForm({
        customerName: '',
        phoneNumber: '',
        serviceType: 'Oil Change',
        appointmentTime: defaultTomorrow(),
        vehicle: '',
        location: 'Bay Area Honda Service Center',
      });
      setFlash('Appointment added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this appointment?')) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `DELETE returned ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleSendReschedule = async (id: string) => {
    setBusyId(id);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/send-reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `POST returned ${res.status}`);
      setFlash(
        `RCS quick-reply sent (SID ${body.messageSid}). Options: ${body.proposedLabels?.join(' · ')}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const banner = useMemo(() => {
    if (source === 'airtable') {
      return (
        <div className={`${styles.banner} ${styles.bannerOk}`}>
          <span className={styles.bannerDot} /> Airtable connected — records are live.
        </div>
      );
    }
    if (source === 'local' && sourceError) {
      return (
        <div className={`${styles.banner} ${styles.bannerErr}`}>
          <span className={styles.bannerDot} /> Airtable is reachable but the query failed —
          using local fallback. Details: <code className={styles.inlineCode}>{sourceError}</code>
        </div>
      );
    }
    if (source === 'local') {
      return (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          <span className={styles.bannerDot} /> Using local fallback — set{' '}
          <code className={styles.inlineCode}>AIRTABLE_API_KEY</code>,{' '}
          <code className={styles.inlineCode}>AIRTABLE_BASE_ID</code>, and{' '}
          <code className={styles.inlineCode}>AIRTABLE_APPOINTMENTS_TABLE</code> to persist.
        </div>
      );
    }
    return null;
  }, [source, sourceError]);

  return (
    <Layout
      title="Appointments"
      subtitle="View and manage appointment records shared with the voice agent. Add a test appointment, or manually trigger an RCS quick-reply offer to test the confirm-by-tap experience."
    >
      {banner}
      {error && <div className={`${styles.banner} ${styles.bannerErr}`}>{error}</div>}
      {flash && <div className={`${styles.banner} ${styles.bannerOk}`}>{flash}</div>}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardHeading}>Appointments</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Service</th>
                  <th>Vehicle</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={7}>Loading…</td>
                  </tr>
                )}
                {!loading && appointments.length === 0 && (
                  <tr>
                    <td colSpan={7}>No appointments yet — add one below.</td>
                  </tr>
                )}
                {!loading &&
                  appointments.map((a) => (
                    <tr key={a.id}>
                      <td>{a.customerName || '—'}</td>
                      <td>{a.phoneNumber || '—'}</td>
                      <td>{a.serviceType || '—'}</td>
                      <td>{a.vehicle || '—'}</td>
                      <td>{formatDisplay(a.appointmentTime)}</td>
                      <td>
                        <span className={`${styles.statusChip} ${statusClass(a.status)}`}>
                          {a.status}
                        </span>
                      </td>
                      <td>
                        <div className={styles.actions ?? ''} style={{ display: 'flex', gap: 8 }}>
                          <button
                            className={`${styles.button} ${styles.buttonPrimary}`}
                            onClick={() => handleSendReschedule(a.id)}
                            disabled={busyId === a.id}
                          >
                            {busyId === a.id ? 'Sending…' : 'Send Reschedule Options'}
                          </button>
                          <button
                            className={`${styles.button} ${styles.buttonDanger}`}
                            onClick={() => handleDelete(a.id)}
                            disabled={busyId === a.id}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>Add test appointment</h2>
          <p className={styles.helper}>
            Use a real mobile number if you want to test the RCS quick-reply — ideally an
            Android device with Google Messages/RCS enabled.
          </p>
          <form className={styles.form} onSubmit={handleAdd}>
            <div className={styles.field}>
              <label className={styles.label}>Customer name</label>
              <input
                className={styles.input}
                required
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                placeholder="Alex Rivera"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Phone (E.164)</label>
              <input
                className={styles.input}
                required
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                placeholder="+15555551001"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Service type</label>
              <select
                className={styles.select}
                value={form.serviceType}
                onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
              >
                <option>Oil Change</option>
                <option>Tire Rotation</option>
                <option>Brake Inspection</option>
                <option>Multi-point Inspection</option>
                <option>Battery Check</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Vehicle</label>
              <input
                className={styles.input}
                value={form.vehicle}
                onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
                placeholder="2022 Honda Civic"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Location</label>
              <input
                className={styles.input}
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Appointment time</label>
              <input
                type="datetime-local"
                className={styles.input}
                required
                value={form.appointmentTime}
                onChange={(e) => setForm({ ...form, appointmentTime: e.target.value })}
              />
            </div>
            <div className={styles.formActions}>
              <button type="submit" className={`${styles.button} ${styles.buttonPrimary}`}>
                Add appointment
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => load()}
              >
                Refresh
              </button>
            </div>
          </form>
        </section>
      </div>
    </Layout>
  );
}
