import type { NextApiRequest, NextApiResponse } from 'next';
import {
  deleteAppointment,
  getAppointment,
  updateAppointment,
} from '../../../utils/airtableAppointments';
import type { AppointmentInput } from '../../../utils/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = String(req.query.id ?? '');
  if (!id) return res.status(400).json({ error: 'Missing appointment id' });

  if (req.method === 'GET') {
    const appt = await getAppointment(id);
    if (!appt) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(appt);
  }

  if (req.method === 'PATCH') {
    const patch = req.body as Partial<AppointmentInput>;
    const updated = await updateAppointment(id, patch);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(updated);
  }

  if (req.method === 'DELETE') {
    const ok = await deleteAppointment(id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
