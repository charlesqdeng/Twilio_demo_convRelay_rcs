import type { NextApiRequest, NextApiResponse } from 'next';
import {
  RESCHEDULE_TEMPLATE_BODY,
  RESCHEDULE_TEMPLATE_NAME,
  resolveRescheduleContentSid,
} from '../../utils/contentSid';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const forceLookup = req.query.refresh === '1' || req.method === 'POST';

  try {
    const resolved = await resolveRescheduleContentSid(forceLookup);
    return res.status(200).json({
      ...resolved,
      friendlyName: RESCHEDULE_TEMPLATE_NAME,
      templateBody: RESCHEDULE_TEMPLATE_BODY,
    });
  } catch (err) {
    console.error('[content-sid] failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }
}
