export type AppointmentStatus =
  | 'Scheduled'
  | 'Confirmed'
  | 'Rescheduled'
  | 'Cancelled';

export interface Appointment {
  id: string;
  customerName: string;
  phoneNumber: string;
  serviceType: string;
  appointmentTime: string;
  status: AppointmentStatus;
  location?: string;
  vehicle?: string;
  proposedTimes?: string[];
  notes?: string;
}

export type AppointmentInput = Omit<Appointment, 'id'>;

export type AppointmentSource = 'airtable' | 'local';
