import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { findByPhone, updateAppointment } from '../../utils/airtableAppointments';
import { formatSlotLabel } from '../../utils/proposedSlots';

const MessagingResponse = Twilio.twiml.MessagingResponse;

function normalizePhone(raw: string): string {
  return raw.replace(/^rcs:/i, '').trim();
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Try hard to figure out which slot the caller picked. RCS quick-reply taps
 * arrive as normal inbound messages with `Body` = the button title. SMS
 * fallbacks may arrive as "1"/"2"/"3" or "option 1", etc. Some Twilio senders
 * also include a `ButtonPayload` or `ButtonText` field.
 */
function pickMatchingSlot(
  body: string,
  buttonPayload: string,
  proposed: string[],
): { iso: string | null; strategy: string } {
  const labels = proposed.map(formatSlotLabel);
  const bodyLc = normalizeText(body);
  const payloadLc = normalizeText(buttonPayload);

  // 1. Button payload of the form "slot_1" / "slot_2" / "slot_3" (most reliable when present)
  const payloadMatch = /slot[_\s-]?(\d+)/.exec(payloadLc);
  if (payloadMatch) {
    const idx = Number.parseInt(payloadMatch[1], 10) - 1;
    if (idx >= 0 && idx < proposed.length) return { iso: proposed[idx], strategy: 'button_payload_slot_id' };
  }

  // 2. Full label match (case + whitespace insensitive, ignore commas). Do this
  //    BEFORE any numeric fallback, since labels contain digits (e.g. "2:00 PM").
  for (let i = 0; i < labels.length; i++) {
    if (bodyLc.includes(normalizeText(labels[i]))) return { iso: proposed[i], strategy: 'full_label' };
  }

  // 3. Extract time from body (e.g., "10:00 AM") and match against labels
  const timeMatch = /(\d{1,2}:\d{2}\s*(?:am|pm))/i.exec(bodyLc);
  if (timeMatch) {
    const t = timeMatch[1].toLowerCase().replace(/\s+/g, ' ');
    for (let i = 0; i < labels.length; i++) {
      if (normalizeText(labels[i]).includes(t)) return { iso: proposed[i], strategy: 'time_only' };
    }
  }

  // 4. Pure numeric SMS-fallback reply — the WHOLE body must be "1"/"2"/"3"
  //    (optionally with "option " prefix). Anchored so digits inside a label
  //    don't accidentally match.
  const strictNumeric = /^(?:option\s*)?([123])\.?$/i.exec(bodyLc);
  if (strictNumeric) {
    const idx = Number.parseInt(strictNumeric[1], 10) - 1;
    if (idx >= 0 && idx < proposed.length) return { iso: proposed[idx], strategy: 'numeric_reply' };
  }

  return { iso: null, strategy: 'no_match' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  const twiml = new MessagingResponse();
  res.setHeader('Content-Type', 'text/xml');

  const body = (req.body ?? {}) as Record<string, string | undefined>;
  const fromRaw = typeof body.From === 'string' ? body.From : '';
  const from = normalizePhone(fromRaw);
  const messageBody = typeof body.Body === 'string' ? body.Body : '';
  const buttonPayload = typeof body.ButtonPayload === 'string' ? body.ButtonPayload : '';

  console.log('[rcs-inbound] payload:', {
    From: fromRaw,
    normalizedFrom: from,
    Body: messageBody,
    ButtonPayload: buttonPayload,
    OriginalRepliedMessageSid: body.OriginalRepliedMessageSid,
    MessageSid: body.MessageSid,
    NumMedia: body.NumMedia,
  });

  if (!from) {
    console.warn('[rcs-inbound] missing From');
    return res.status(200).send(twiml.toString());
  }

  const appt = await findByPhone(from);
  if (!appt) {
    console.warn('[rcs-inbound] no appointment for', from);
    return res.status(200).send(twiml.toString());
  }

  const proposed = appt.proposedTimes;
  if (!proposed || proposed.length === 0) {
    console.warn('[rcs-inbound] appointment has no proposed times:', appt.id);
    twiml.message(
      "Thanks for the reply — we don't currently have new times pending for your appointment. Please call us if you'd like to change it.",
    );
    return res.status(200).send(twiml.toString());
  }

  const { iso: chosen, strategy } = pickMatchingSlot(messageBody, buttonPayload, proposed);
  console.log('[rcs-inbound] slot match:', {
    strategy,
    chosen,
    proposedLabels: proposed.map(formatSlotLabel),
  });

  if (!chosen) {
    twiml.message(
      "Sorry, I couldn't tell which time you picked. Please reply with 1, 2, or 3 to choose the option — or call us to reschedule.",
    );
    return res.status(200).send(twiml.toString());
  }

  const updated = await updateAppointment(appt.id, {
    appointmentTime: chosen,
    status: 'Rescheduled',
  });
  console.log('[rcs-inbound] appointment updated:', {
    id: appt.id,
    ok: Boolean(updated),
    newTime: chosen,
  });

  const chosenLabel = formatSlotLabel(chosen);
  twiml.message(
    `Great — your appointment is confirmed for ${chosenLabel}. See you then!`,
  );

  return res.status(200).send(twiml.toString());
}
