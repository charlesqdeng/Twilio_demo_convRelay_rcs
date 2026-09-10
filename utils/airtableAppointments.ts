import Airtable from 'airtable';
import type {
  Appointment,
  AppointmentInput,
  AppointmentSource,
  AppointmentStatus,
} from './types';
import {
  createLocal,
  deleteLocal,
  findLocalByPhone,
  getLocal,
  listLocal,
  updateLocal,
} from './localAppointments';

const FIELD = {
  CustomerName: 'CustomerName',
  Phone: 'Phone',
  Service: 'Service',
  Date: 'Date',
  Time: 'Time',
  Status: 'Status',
  OfferedSlots: 'OfferedSlots',
  Location: 'Location',
  Vehicle: 'Vehicle',
  Notes: 'Notes',
} as const;

function haveCreds(): boolean {
  return Boolean(
    process.env.AIRTABLE_API_KEY &&
      process.env.AIRTABLE_BASE_ID &&
      process.env.AIRTABLE_APPOINTMENTS_TABLE,
  );
}

let cachedBase: Airtable.Base | null = null;
function base(): Airtable.Base {
  if (!cachedBase) {
    cachedBase = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
      process.env.AIRTABLE_BASE_ID as string,
    );
  }
  return cachedBase;
}

function tableName(): string {
  return process.env.AIRTABLE_APPOINTMENTS_TABLE as string;
}

// ---- Case normalization for Status ----------------------------------------
// Airtable stores status as lowercase ("confirmed"). The Appointment type
// uses Capitalized values for cleaner UI code. Normalize at the boundary.

function statusFromAirtable(raw: string): AppointmentStatus {
  const s = raw.trim().toLowerCase();
  if (s === 'confirmed') return 'Confirmed';
  if (s === 'rescheduled') return 'Rescheduled';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  return 'Scheduled';
}

function statusToAirtable(s: AppointmentStatus): string {
  return s.toLowerCase();
}

// ---- Date + Time combiner --------------------------------------------------
// Airtable splits the appointment into Date ("2026-09-11") and Time
// ("10:00 AM"). The Appointment model uses a single ISO string. Combine on
// read, split on write.

function combineDateAndTime(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  const cleanDate = dateStr.trim();
  const cleanTime = (timeStr ?? '').trim();
  if (!cleanTime) {
    return `${cleanDate}T00:00:00`;
  }
  const parsed = new Date(`${cleanDate} ${cleanTime}`);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return `${cleanDate}T00:00:00`;
}

function splitDateAndTime(iso: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return { date, time };
}

// ---- Record <-> Appointment mapping ---------------------------------------

function fromRecord(record: Airtable.Record<Airtable.FieldSet>): Appointment {
  const fields = record.fields;
  let proposedTimes: string[] | undefined;
  const rawProposed = fields[FIELD.OfferedSlots];
  if (typeof rawProposed === 'string' && rawProposed.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawProposed);
      if (Array.isArray(parsed)) proposedTimes = parsed.map(String);
    } catch {
      // ignore malformed json — treat as no proposed times
    }
  }
  return {
    id: record.id,
    customerName: String(fields[FIELD.CustomerName] ?? ''),
    phoneNumber: String(fields[FIELD.Phone] ?? ''),
    serviceType: String(fields[FIELD.Service] ?? ''),
    appointmentTime: combineDateAndTime(
      String(fields[FIELD.Date] ?? ''),
      String(fields[FIELD.Time] ?? ''),
    ),
    status: statusFromAirtable(String(fields[FIELD.Status] ?? 'scheduled')),
    location: fields[FIELD.Location] ? String(fields[FIELD.Location]) : undefined,
    vehicle: fields[FIELD.Vehicle] ? String(fields[FIELD.Vehicle]) : undefined,
    proposedTimes,
    notes: fields[FIELD.Notes] ? String(fields[FIELD.Notes]) : undefined,
  };
}

function toFields(input: Partial<AppointmentInput>): Partial<Airtable.FieldSet> {
  const out: Partial<Airtable.FieldSet> = {};
  if (input.customerName !== undefined) out[FIELD.CustomerName] = input.customerName;
  if (input.phoneNumber !== undefined) out[FIELD.Phone] = input.phoneNumber;
  if (input.serviceType !== undefined) out[FIELD.Service] = input.serviceType;
  if (input.appointmentTime !== undefined) {
    const { date, time } = splitDateAndTime(input.appointmentTime);
    out[FIELD.Date] = date;
    out[FIELD.Time] = time;
  }
  if (input.status !== undefined) out[FIELD.Status] = statusToAirtable(input.status);
  if (input.location !== undefined) out[FIELD.Location] = input.location;
  if (input.vehicle !== undefined) out[FIELD.Vehicle] = input.vehicle;
  if (input.proposedTimes !== undefined)
    out[FIELD.OfferedSlots] = JSON.stringify(input.proposedTimes);
  if (input.notes !== undefined) out[FIELD.Notes] = input.notes;
  return out;
}

// ---- Public API ------------------------------------------------------------

export interface ListResult {
  source: AppointmentSource;
  appointments: Appointment[];
  error?: string;
}

function airtableErrorMessage(err: unknown): string {
  const e = err as { message?: string; error?: string; statusCode?: number } | undefined;
  if (!e) return String(err);
  const parts: string[] = [];
  if (e.error) parts.push(String(e.error));
  if (e.message) parts.push(String(e.message));
  if (e.statusCode) parts.push(`(${e.statusCode})`);
  return parts.length ? parts.join(' ') : String(err);
}

export async function listAppointments(): Promise<ListResult> {
  if (!haveCreds()) return { source: 'local', appointments: listLocal() };
  try {
    const records = await base()(tableName()).select().all();
    const appts = records
      .map(fromRecord)
      .sort((a, b) => a.appointmentTime.localeCompare(b.appointmentTime));
    return { source: 'airtable', appointments: appts };
  } catch (err) {
    console.warn('[airtable] list failed, falling back to local:', err);
    return {
      source: 'local',
      appointments: listLocal(),
      error: airtableErrorMessage(err),
    };
  }
}

export async function getAppointment(id: string): Promise<Appointment | null> {
  if (!haveCreds() || id.startsWith('local_')) return getLocal(id) ?? null;
  try {
    const record = await base()(tableName()).find(id);
    return fromRecord(record);
  } catch (err) {
    console.warn('[airtable] get failed, falling back to local:', err);
    return getLocal(id) ?? null;
  }
}

export async function createAppointment(input: AppointmentInput): Promise<Appointment> {
  if (!haveCreds()) return createLocal(input);
  try {
    const created = await base()(tableName()).create(toFields(input));
    return fromRecord(created);
  } catch (err) {
    console.warn('[airtable] create failed, falling back to local:', err);
    return createLocal(input);
  }
}

export async function updateAppointment(
  id: string,
  patch: Partial<AppointmentInput>,
): Promise<Appointment | null> {
  if (!haveCreds() || id.startsWith('local_')) return updateLocal(id, patch) ?? null;
  try {
    const updated = await base()(tableName()).update(id, toFields(patch));
    return fromRecord(updated);
  } catch (err) {
    console.warn('[airtable] update failed, falling back to local:', err);
    return updateLocal(id, patch) ?? null;
  }
}

export async function deleteAppointment(id: string): Promise<boolean> {
  if (!haveCreds() || id.startsWith('local_')) return deleteLocal(id);
  try {
    await base()(tableName()).destroy(id);
    return true;
  } catch (err) {
    console.warn('[airtable] delete failed, falling back to local:', err);
    return deleteLocal(id);
  }
}

export async function findByPhone(phone: string): Promise<Appointment | null> {
  const normalized = phone.replace(/\D/g, '');
  if (!haveCreds()) return findLocalByPhone(phone) ?? null;
  try {
    const records = await base()(tableName()).select({ maxRecords: 100 }).all();
    const match = records.find((r) => {
      const stored = String(r.fields[FIELD.Phone] ?? '').replace(/\D/g, '');
      return stored && stored === normalized;
    });
    return match ? fromRecord(match) : null;
  } catch (err) {
    console.warn('[airtable] findByPhone failed, falling back to local:', err);
    return findLocalByPhone(phone) ?? null;
  }
}

export function isConfigured(): boolean {
  return haveCreds();
}
