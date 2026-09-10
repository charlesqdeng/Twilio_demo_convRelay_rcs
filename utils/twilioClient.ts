import Twilio from 'twilio';

let cachedClient: ReturnType<typeof Twilio> | null = null;

export function getTwilioClient() {
  if (cachedClient) return cachedClient;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID ?? process.env.TWILIO_API_KEY;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET ?? process.env.TWILIO_API_SECRET;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid) {
    throw new Error('TWILIO_ACCOUNT_SID is not set');
  }

  if (apiKeySid && apiKeySecret) {
    cachedClient = Twilio(apiKeySid, apiKeySecret, { accountSid });
  } else if (authToken) {
    cachedClient = Twilio(accountSid, authToken);
  } else {
    throw new Error(
      'Set TWILIO_AUTH_TOKEN, or TWILIO_API_KEY_SID+TWILIO_API_KEY_SECRET (or TWILIO_API_KEY+TWILIO_API_SECRET)',
    );
  }
  return cachedClient;
}

export interface SendRcsArgs {
  to: string;
  contentSid: string;
  contentVariables: Record<string, string>;
}

/**
 * Sends an RCS quick-reply through the configured Twilio Messaging Service.
 * If RCS_FROM_NUMBER is set to an `rcs:` sender ID, it forces RCS-only delivery
 * (no SMS fallback) and prefixes the recipient with `rcs:` per Twilio's rule.
 * Otherwise the message goes through TWILIO_MESSAGING_SERVICE_SID, which lets
 * Twilio fall back to SMS for non-RCS-capable recipients.
 */
export async function sendRcsQuickReply({ to, contentSid, contentVariables }: SendRcsArgs) {
  const client = getTwilioClient();
  const rcsFrom = process.env.RCS_FROM_NUMBER?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

  const params: Record<string, unknown> = {
    contentSid,
    contentVariables: JSON.stringify(contentVariables),
  };

  if (rcsFrom && rcsFrom.startsWith('rcs:')) {
    params.from = rcsFrom;
    params.to = to.startsWith('rcs:') ? to : `rcs:${to}`;
  } else {
    if (!messagingServiceSid) {
      throw new Error(
        'Set TWILIO_MESSAGING_SERVICE_SID (or RCS_FROM_NUMBER starting with rcs:)',
      );
    }
    params.messagingServiceSid = messagingServiceSid;
    params.to = to;
  }

  return client.messages.create(
    params as unknown as Parameters<typeof client.messages.create>[0],
  );
}
