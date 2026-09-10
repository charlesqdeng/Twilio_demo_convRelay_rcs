import type { NextApiRequest, NextApiResponse } from 'next';
import { getIO } from './socket';

interface TwilioTranscriptionPayload {
  CallSid?: string;
  TranscriptionSid?: string;
  TranscriptionEvent?: string;
  TranscriptionData?: string;
  Track?: string;
  Final?: string;
  SequenceId?: string;
  LanguageCode?: string;
}

interface TranscriptData {
  transcript?: string;
  Transcript?: string;
  confidence?: number;
}

function parseTranscript(raw: string | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as TranscriptData;
    return String(parsed.transcript ?? parsed.Transcript ?? '');
  } catch {
    return raw;
  }
}

function speakerFor(track: string | undefined): 'AGENT' | 'CALLER' {
  // outbound_track = the leg initiated by the caller (browser); inbound_track = the answered leg (agent)
  return track === 'inbound_track' ? 'AGENT' : 'CALLER';
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  const body = (req.body ?? {}) as TwilioTranscriptionPayload;
  const callSid = body.CallSid ?? '';
  const text = parseTranscript(body.TranscriptionData);
  const isFinal = body.Final === 'true';

  if (callSid && text) {
    const io = getIO();
    io?.to(`call:${callSid}`).emit('transcript', {
      speaker: speakerFor(body.Track),
      text,
      isFinal,
      timestamp: Date.now(),
      callSid,
    });
  }

  res.status(200).end();
}
