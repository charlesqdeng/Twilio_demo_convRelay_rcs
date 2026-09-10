import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';

const AccessToken = Twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID ?? process.env.TWILIO_API_KEY;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET ?? process.env.TWILIO_API_SECRET;
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID;

  if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
    return res.status(500).json({
      error:
        'Missing Twilio credentials — need TWILIO_ACCOUNT_SID, TWILIO_API_KEY(_SID)+SECRET, and TWILIO_TWIML_APP_SID.',
    });
  }

  const identity =
    (typeof req.query.identity === 'string' && req.query.identity) ||
    `dashboard_${Math.random().toString(36).slice(2, 10)}`;

  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity,
    ttl: 3600,
  });
  token.addGrant(
    new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: false }),
  );

  return res.status(200).json({ token: token.toJwt(), identity, ttl: 3600 });
}
