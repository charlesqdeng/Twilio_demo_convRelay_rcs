import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Twilio Intelligence returns a redacted-media URL that requires Basic Auth.
 * We fetch it server-side and stream to the browser so <audio> can play it
 * inline without triggering an auth prompt.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const target = String(req.query.url ?? '');
  if (!target.startsWith('https://')) return res.status(400).send('Bad URL');

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const apiKey = process.env.TWILIO_API_KEY_SID ?? process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_KEY_SECRET ?? process.env.TWILIO_API_SECRET;

  const user = apiKey ?? accountSid;
  const pass = apiSecret ?? authToken;
  if (!user || !pass) return res.status(500).send('Missing Twilio credentials');

  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  try {
    // Follow redirects manually because the redacted-media URL 302s to a
    // pre-signed S3 URL that must be called WITHOUT the Basic Auth header.
    let response = await fetch(target, {
      redirect: 'manual',
      headers: { Authorization: `Basic ${auth}` },
    });
    while (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      const next = response.headers.get('location') as string;
      response = await fetch(next, { redirect: 'manual' });
    }
    if (!response.ok || !response.body) {
      return res.status(response.status).send('Upstream error');
    }
    res.setHeader('Content-Type', response.headers.get('content-type') ?? 'audio/mpeg');
    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    console.error('[proxy-redacted-media] failed:', err);
    res.status(500).send('Proxy error');
  }
}
