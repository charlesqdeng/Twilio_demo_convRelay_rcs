import type { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';

interface PiiEntity {
  type: string;
  value: string;
  confidence: number;
}

export interface CallAnalysis {
  sentiment: {
    label: 'positive' | 'neutral' | 'negative' | 'mixed';
    score: number;
    rationale: string;
  };
  pii: {
    found: boolean;
    types: string[];
    count: number;
    summary: string;
  };
}

let cachedClient: OpenAI | null = null;
function openai(): OpenAI {
  if (!cachedClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return cachedClient;
}

const SYSTEM_PROMPT = `You analyze a short phone transcript between the Bay Area Learning Center AI voice agent ("AGENT") and a student caller ("CALLER") who is managing their course enrollment. Produce a strict JSON object with:
- sentiment.label: one of "positive", "neutral", "negative", "mixed" — reflecting the caller's experience over the whole call
- sentiment.score: a number from -1.0 (very negative) to 1.0 (very positive)
- sentiment.rationale: one sentence (<= 25 words), grounded in specific moments of the call
- pii.summary: one sentence (<= 30 words) describing which categories of PII were discussed and in what context, or "No personally identifiable information was discussed." if none

Return ONLY the JSON object, no prose, no code fences.`;

function uniqueTypes(entities: PiiEntity[]): string[] {
  return Array.from(new Set(entities.map((e) => e.type).filter(Boolean)));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as {
    fullTranscript?: string;
    piiEntities?: PiiEntity[];
  };

  const transcript = (body.fullTranscript ?? '').trim();
  if (!transcript) return res.status(400).json({ error: 'fullTranscript is required' });

  const piiEntities = Array.isArray(body.piiEntities) ? body.piiEntities : [];
  const types = uniqueTypes(piiEntities);

  try {
    const client = openai();
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_ANALYSIS_MODEL ?? 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            `Transcript:\n${transcript}`,
            '',
            `PII entities already detected by Twilio Intelligence (ground truth for the pii.summary — do not invent other categories):`,
            types.length ? types.map((t) => `- ${t}`).join('\n') : '- (none)',
          ].join('\n'),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed: Partial<CallAnalysis> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const label =
      parsed.sentiment?.label && ['positive', 'neutral', 'negative', 'mixed'].includes(parsed.sentiment.label)
        ? parsed.sentiment.label
        : 'neutral';
    const score = typeof parsed.sentiment?.score === 'number' ? parsed.sentiment.score : 0;
    const rationale =
      typeof parsed.sentiment?.rationale === 'string' && parsed.sentiment.rationale.trim()
        ? parsed.sentiment.rationale.trim()
        : 'No clear sentiment indicators in the transcript.';

    const summary =
      typeof parsed.pii?.summary === 'string' && parsed.pii.summary.trim()
        ? parsed.pii.summary.trim()
        : piiEntities.length > 0
          ? `${piiEntities.length} PII item(s) of type ${types.join(', ')} were discussed.`
          : 'No personally identifiable information was discussed.';

    const analysis: CallAnalysis = {
      sentiment: { label, score, rationale },
      pii: {
        found: piiEntities.length > 0,
        types,
        count: piiEntities.length,
        summary,
      },
    };

    return res.status(200).json(analysis);
  } catch (err) {
    console.error('[call-analysis] failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
}
