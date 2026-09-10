import { getTwilioClient } from './twilioClient';

export const RESCHEDULE_TEMPLATE_NAME = 'betwext_reschedule_options_v1';
export const RESCHEDULE_TEMPLATE_BODY =
  'Hi {{1}}, here are three new times for your appointment — tap one to confirm.';

interface ContentResource {
  sid: string;
  friendlyName?: string;
}

export interface ResolvedContentSid {
  contentSid: string;
  isNew: boolean;
  source: 'env' | 'lookup' | 'created';
}

async function findByFriendlyName(name: string): Promise<string | null> {
  const client = getTwilioClient();
  const all = await (client as unknown as {
    content: { v1: { contents: { list: (opts: { limit: number }) => Promise<ContentResource[]> } } };
  }).content.v1.contents.list({ limit: 200 });
  const match = all.find((c) => c.friendlyName === name);
  return match ? match.sid : null;
}

async function createRescheduleTemplate(): Promise<string> {
  // The Twilio Node SDK's content.v1.contents.create silently drops
  // `friendlyName` (camelCase) — the resource is created but its
  // friendly_name comes back null, which breaks the lookup-by-friendly-name
  // path on subsequent runs. Go straight to the raw REST endpoint with the
  // snake_case field to avoid the bug.
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const user = process.env.TWILIO_API_KEY_SID ?? process.env.TWILIO_API_KEY ?? accountSid;
  const pass = process.env.TWILIO_API_KEY_SECRET ?? process.env.TWILIO_API_SECRET ?? process.env.TWILIO_AUTH_TOKEN;
  if (!user || !pass) throw new Error('Twilio credentials missing');
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const res = await fetch('https://content.twilio.com/v1/Content', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      friendly_name: RESCHEDULE_TEMPLATE_NAME,
      language: 'en',
      variables: {
        '1': 'there',
        '2': 'Mon Jan 1, 10:00 AM',
        '3': 'Tue Jan 2, 2:00 PM',
        '4': 'Wed Jan 3, 4:00 PM',
      },
      types: {
        'twilio/quick-reply': {
          body: RESCHEDULE_TEMPLATE_BODY,
          actions: [
            { id: 'slot_1', title: '{{2}}' },
            { id: 'slot_2', title: '{{3}}' },
            { id: 'slot_3', title: '{{4}}' },
          ],
        },
        'twilio/text': {
          body:
            RESCHEDULE_TEMPLATE_BODY +
            '\n\nReply with your preferred option:\n1) {{2}}\n2) {{3}}\n3) {{4}}',
        },
      },
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Content API create failed (${res.status}): ${errBody}`);
  }
  const body = (await res.json()) as { sid: string };
  return body.sid;
}

/**
 * Resolves the reschedule Content SID. Priority:
 *   1. TWILIO_RESCHEDULE_CONTENT_SID env var (fastest — set this once and skip
 *      Content API round-trips on every send).
 *   2. Existing Content resource whose friendlyName matches RESCHEDULE_TEMPLATE_NAME.
 *   3. Creates a fresh one with the canonical body/actions.
 *
 * Set `forceLookup` to true (via the setup page's "Fetch or create by friendly
 * name" button) to skip the env override and go straight to the Content API.
 */
export async function resolveRescheduleContentSid(
  forceLookup = false,
): Promise<ResolvedContentSid> {
  if (!forceLookup) {
    const envSid = process.env.TWILIO_RESCHEDULE_CONTENT_SID?.trim();
    if (envSid) return { contentSid: envSid, isNew: false, source: 'env' };
  }

  const existing = await findByFriendlyName(RESCHEDULE_TEMPLATE_NAME);
  if (existing) return { contentSid: existing, isNew: false, source: 'lookup' };

  const created = await createRescheduleTemplate();
  return { contentSid: created, isNew: true, source: 'created' };
}
