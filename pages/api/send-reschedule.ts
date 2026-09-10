import type { NextApiRequest, NextApiResponse } from 'next';
import { getAppointment } from '../../utils/airtableAppointments';
import { sendRescheduleOffer } from '../../utils/reschedule';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { appointmentId } = req.body ?? {};
  if (!appointmentId) return res.status(400).json({ error: 'appointmentId is required' });

  const appt = await getAppointment(String(appointmentId));
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });

  try {
    const result = await sendRescheduleOffer(appt);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[send-reschedule] failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
