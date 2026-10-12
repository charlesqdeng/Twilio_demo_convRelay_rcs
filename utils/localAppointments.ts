import type { Appointment, AppointmentInput } from './types';

function seed(): Appointment[] {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(10, 0, 0, 0);
  const dayAfter = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  dayAfter.setHours(14, 0, 0, 0);
  return [
    {
      id: 'local_demo_1',
      customerName: 'Alex Rivera',
      phoneNumber: '+15555551001',
      serviceType: 'Intro to Python',
      vehicle: 'Spring 2026 Evening',
      appointmentTime: tomorrow.toISOString(),
      status: 'Scheduled',
    },
    {
      id: 'local_demo_2',
      customerName: 'Priya Shah',
      phoneNumber: '+15555551002',
      serviceType: 'SAT Prep',
      vehicle: 'Weekend Cohort',
      appointmentTime: dayAfter.toISOString(),
      status: 'Scheduled',
    },
  ];
}

const g = globalThis as unknown as { __betwext_local_store?: Map<string, Appointment> };
if (!g.__betwext_local_store) {
  g.__betwext_local_store = new Map(seed().map((a) => [a.id, a]));
}
const store: Map<string, Appointment> = g.__betwext_local_store;

let nextId = 3;

export function listLocal(): Appointment[] {
  return Array.from(store.values()).sort((a, b) =>
    a.appointmentTime.localeCompare(b.appointmentTime),
  );
}

export function getLocal(id: string): Appointment | undefined {
  return store.get(id);
}

export function createLocal(input: AppointmentInput): Appointment {
  const id = `local_${nextId++}`;
  const record: Appointment = { id, ...input };
  store.set(id, record);
  return record;
}

export function updateLocal(id: string, patch: Partial<AppointmentInput>): Appointment | undefined {
  const existing = store.get(id);
  if (!existing) return undefined;
  const updated: Appointment = { ...existing, ...patch };
  store.set(id, updated);
  return updated;
}

export function deleteLocal(id: string): boolean {
  return store.delete(id);
}

export function findLocalByPhone(phone: string): Appointment | undefined {
  const normalized = phone.replace(/\D/g, '');
  return Array.from(store.values()).find(
    (a) => a.phoneNumber.replace(/\D/g, '') === normalized,
  );
}
