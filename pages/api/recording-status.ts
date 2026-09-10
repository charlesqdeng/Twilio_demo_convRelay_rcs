import type { NextApiRequest, NextApiResponse } from 'next';
import { getTwilioClient } from '../../utils/twilioClient';

const SERVICE_UNIQUE_NAME = 'betwext-conversation-intelligence';
const SERVICE_FRIENDLY_NAME = 'Betwext Conversation Intelligence';

interface TwilioService {
  sid: string;
  uniqueName?: string;
  friendlyName?: string;
  autoRedaction?: boolean;
  mediaRedaction?: boolean;
}

async function ensureIntelligenceService(): Promise<string> {
  const cached = process.env.TWILIO_INTELLIGENCE_SERVICE_SID?.trim();
  if (cached) return cached;

  const client = getTwilioClient();
  const svc = client as unknown as {
    intelligence: {
      v2: {
        services: {
          list: (opts: { limit: number }) => Promise<TwilioService[]>;
          create: (payload: unknown) => Promise<TwilioService>;
        };
      };
    };
  };

  const existing = await svc.intelligence.v2.services.list({ limit: 200 });
  const match = existing.find(
    (s) => s.uniqueName === SERVICE_UNIQUE_NAME || s.friendlyName === SERVICE_FRIENDLY_NAME,
  );
  if (match) return match.sid;

  const created = await svc.intelligence.v2.services.create({
    uniqueName: SERVICE_UNIQUE_NAME,
    friendlyName: SERVICE_FRIENDLY_NAME,
    autoRedaction: true,
    mediaRedaction: true,
    languageCode: 'en-US',
  });
  return created.sid;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const recordingSid = String(req.body?.RecordingSid ?? '');
  const callSid = String(req.body?.CallSid ?? '');
  const status = String(req.body?.RecordingStatus ?? '');

  if (!recordingSid || status !== 'completed') {
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    const serviceSid = await ensureIntelligenceService();
    const operatorSid = process.env.TWILIO_INTELLIGENCE_OPERATOR_SID?.trim();
    const client = getTwilioClient();
    const transcripts = (
      client as unknown as {
        intelligence: {
          v2: {
            transcripts: { create: (payload: unknown) => Promise<{ sid: string }> };
          };
        };
      }
    ).intelligence.v2.transcripts;

    const transcript = await transcripts.create({
      serviceSid,
      channel: {
        media_properties: { source_sid: recordingSid },
      },
      customerKey: callSid || recordingSid,
      redaction: true,
    });

    // Attach the language operator, if configured, so entity extraction runs
    if (operatorSid) {
      try {
        await (
          client as unknown as {
            intelligence: {
              v2: {
                transcripts: (sid: string) => {
                  operatorAttachment: (opSid: string) => {
                    create: () => Promise<unknown>;
                  };
                };
              };
            };
          }
        ).intelligence
          .v2.transcripts(transcript.sid)
          .operatorAttachment(operatorSid)
          .create();
      } catch (err) {
        console.warn('[recording-status] operator attach failed (non-fatal):', err);
      }
    }

    console.log(
      `[recording-status] recording=${recordingSid} → transcript=${transcript.sid} (service=${serviceSid})`,
    );
    return res.status(200).json({ ok: true, transcriptSid: transcript.sid, serviceSid });
  } catch (err) {
    console.error('[recording-status] failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
