import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Streams a Twilio Voice recording (the original, un-redacted audio) with
 * Basic Auth applied server-side, so <audio> can play it without triggering
 * a browser auth prompt.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const sid = String(req.query.sid ?? '');
  if (!/^RE[a-zA-Z0-9]+$/.test(sid)) return res.status(400).send('Bad recording SID');

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKey = process.env.TWILIO_API_KEY_SID ?? process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_KEY_SECRET ?? process.env.TWILIO_API_SECRET;

  const user = apiKey ?? accountSid;
  const pass = apiSecret ?? authToken;
  if (!accountSid || !user || !pass) return res.status(500).send('Missing Twilio credentials');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  try {
    const upstream = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status).send('Upstream error');
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'audio/mpeg');
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[proxy-recording] failed:', err);
    res.status(500).send('Proxy error');
  }
}
