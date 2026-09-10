import type { NextApiRequest, NextApiResponse } from 'next';
import { getTwilioClient } from '../../utils/twilioClient';

interface TranscriptInfo {
  sid: string;
  status?: string;
  languageCode?: string;
  serviceSid?: string;
  redaction?: boolean;
}

interface SentenceRow {
  transcript?: string;
  text?: string;
  channel?: number;
  role?: string;
  media_channel?: number;
  mediaChannel?: number;
}

interface OperatorResult {
  operatorType?: string;
  name?: string;
  extractResults?: {
    entities?: Array<{
      type?: string;
      value?: string;
      confidence?: number;
    }>;
  };
  utteranceResults?: Array<{
    label?: string;
    value?: string;
    confidence?: number;
  }>;
}

interface MediaResource {
  mediaUrl?: string;
  redactedMediaUrl?: string;
  sourceSid?: string;
}

async function fetchTranscriptForCall(callSid: string): Promise<TranscriptInfo | null> {
  const client = getTwilioClient();
  const svc = (
    client as unknown as {
      intelligence: {
        v2: {
          transcripts: {
            list: (opts: { customerKey?: string; sourceSid?: string; limit: number }) => Promise<TranscriptInfo[]>;
          };
        };
      };
    }
  ).intelligence.v2.transcripts;
  const byKey = await svc.list({ customerKey: callSid, limit: 5 });
  if (byKey.length) return byKey[0];
  const bySource = await svc.list({ sourceSid: callSid, limit: 5 });
  return bySource[0] ?? null;
}

async function fetchSentences(transcriptSid: string): Promise<SentenceRow[]> {
  const client = getTwilioClient();
  const rows = await (
    client as unknown as {
      intelligence: {
        v2: {
          transcripts: (sid: string) => {
            sentences: { list: (opts: { limit: number }) => Promise<SentenceRow[]> };
          };
        };
      };
    }
  ).intelligence.v2.transcripts(transcriptSid)
    .sentences.list({ limit: 500 });
  return rows;
}

async function fetchOperatorResults(transcriptSid: string): Promise<OperatorResult[]> {
  const client = getTwilioClient();
  try {
    const rows = await (
      client as unknown as {
        intelligence: {
          v2: {
            transcripts: (sid: string) => {
              operatorResults: { list: (opts: { limit: number }) => Promise<OperatorResult[]> };
            };
          };
        };
      }
    ).intelligence.v2.transcripts(transcriptSid)
      .operatorResults.list({ limit: 50 });
    return rows;
  } catch (err) {
    console.warn('[get-recording-pii] operatorResults fetch failed:', err);
    return [];
  }
}

async function fetchMedia(transcriptSid: string): Promise<MediaResource | null> {
  const client = getTwilioClient();
  try {
    const media = await (
      client as unknown as {
        intelligence: {
          v2: {
            transcripts: (sid: string) => {
              media: () => { fetch: (opts: { redacted?: boolean }) => Promise<MediaResource> };
            };
          };
        };
      }
    ).intelligence.v2.transcripts(transcriptSid)
      .media()
      .fetch({ redacted: true });
    return media;
  } catch (err) {
    console.warn('[get-recording-pii] media fetch failed:', err);
    return null;
  }
}

function joinSentences(sentences: SentenceRow[]): string {
  return sentences
    .map((s) => {
      const chan = s.channel ?? s.media_channel ?? s.mediaChannel;
      const speaker = chan === 1 ? 'CALLER' : 'AGENT';
      const text = s.transcript ?? s.text ?? '';
      return `${speaker}: ${text}`;
    })
    .filter((line) => line.split(': ').slice(1).join(': ').trim().length > 0)
    .join('\n');
}

function extractEntities(operatorResults: OperatorResult[]) {
  const seen = new Set<string>();
  const entities: Array<{ type: string; value: string; confidence: number }> = [];
  for (const op of operatorResults) {
    for (const ent of op.extractResults?.entities ?? []) {
      const type = ent.type ?? 'unknown';
      const value = ent.value ?? '';
      if (!value) continue;
      const key = `${type}::${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push({ type, value, confidence: Math.round((ent.confidence ?? 0) * 100) });
    }
    for (const utt of op.utteranceResults ?? []) {
      const type = utt.label ?? 'unknown';
      const value = utt.value ?? '';
      if (!value) continue;
      const key = `${type}::${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entities.push({ type, value, confidence: Math.round((utt.confidence ?? 0) * 100) });
    }
  }
  return entities;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const callSid = String(req.query.callSid ?? req.body?.callSid ?? '');
  const recordingSid = String(req.query.recordingSid ?? req.body?.recordingSid ?? '');

  const publicUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  try {
    const transcript = await fetchTranscriptForCall(callSid || recordingSid);
    if (!transcript) {
      return res.status(200).json({
        status: 'not_ready',
        message: 'Intelligence transcript not created yet — check back shortly.',
      });
    }

    if (transcript.status && transcript.status !== 'completed') {
      return res.status(200).json({
        status: transcript.status,
        transcriptSid: transcript.sid,
      });
    }

    const [sentences, operatorResults, redactedMedia] = await Promise.all([
      fetchSentences(transcript.sid),
      fetchOperatorResults(transcript.sid),
      fetchMedia(transcript.sid),
    ]);

    const fullTranscript = joinSentences(sentences);
    const entities = extractEntities(operatorResults);

    let recordingUrl: string | undefined;
    if (recordingSid && publicUrl) {
      recordingUrl = `${publicUrl}/api/proxy-recording?sid=${encodeURIComponent(recordingSid)}`;
    }
    let redactedMediaUrl: string | undefined;
    if (redactedMedia?.mediaUrl && publicUrl) {
      redactedMediaUrl = `${publicUrl}/api/proxy-redacted-media?url=${encodeURIComponent(
        redactedMedia.mediaUrl,
      )}`;
    }

    return res.status(200).json({
      status: 'completed',
      transcriptSid: transcript.sid,
      recordingSid,
      recordingUrl,
      redactedMediaUrl,
      fullTranscript,
      piiEntities: entities,
      piiCount: entities.length,
      piiTypes: Array.from(new Set(entities.map((e) => e.type))),
    });
  } catch (err) {
    console.error('[get-recording-pii] failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
