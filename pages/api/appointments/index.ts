import type { NextApiRequest, NextApiResponse } from 'next';
import { createAppointment, listAppointments } from '../../../utils/airtableAppointments';
import type { AppointmentInput } from '../../../utils/types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const result = await listAppointments();
    return res.status(200).json(result);
  }

  if (req.method === 'POST') {
    const body = req.body as Partial<AppointmentInput>;
    if (!body?.customerName || !body?.phoneNumber || !body?.appointmentTime) {
      return res
        .status(400)
        .json({ error: 'customerName, phoneNumber, appointmentTime are required' });
    }
    const created = await createAppointment({
      customerName: body.customerName,
      phoneNumber: body.phoneNumber,
      serviceType: body.serviceType ?? 'Course Session',
      appointmentTime: body.appointmentTime,
      status: body.status ?? 'Scheduled',
      vehicle: body.vehicle,
      location: body.location,
      proposedTimes: body.proposedTimes,
      notes: body.notes,
    });
    return res.status(201).json(created);
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
