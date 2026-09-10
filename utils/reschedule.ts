import type { Appointment } from './types';
import { updateAppointment } from './airtableAppointments';
import { resolveRescheduleContentSid } from './contentSid';
import { formatSlotLabel, generateProposedSlots } from './proposedSlots';
import { sendRcsQuickReply } from './twilioClient';

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

export interface RescheduleResult {
  messageSid: string;
  contentSid: string;
  contentSidSource: string;
  proposedTimes: string[];
  proposedLabels: string[];
}

/**
 * Sends the reschedule RCS quick-reply, writes the proposed slots back to the
 * appointment record, and returns the labels + Twilio message SID. Shared by
 * /api/send-reschedule (dashboard button) and the inline voice agent's
 * send_reschedule_rcs tool.
 */
export async function sendRescheduleOffer(appt: Appointment): Promise<RescheduleResult> {
  const proposed = generateProposedSlots();
  const labels = proposed.map(formatSlotLabel);
  const { contentSid, source } = await resolveRescheduleContentSid();
  const message = await sendRcsQuickReply({
    to: appt.phoneNumber,
    contentSid,
    contentVariables: {
      '1': firstName(appt.customerName),
      '2': labels[0],
      '3': labels[1],
      '4': labels[2],
    },
  });
  await updateAppointment(appt.id, { proposedTimes: proposed });
  return {
    messageSid: message.sid,
    contentSid,
    contentSidSource: source,
    proposedTimes: proposed,
    proposedLabels: labels,
  };
}
