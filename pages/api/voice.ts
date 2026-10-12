import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { greeting } from '../../utils/agent';
import { getTwilioClient } from '../../utils/twilioClient';

const VoiceResponse = Twilio.twiml.VoiceResponse;

const AGENT_VOICE = 'Polly.Joanna-Neural';

/**
 * Entry point for every browser dial (and inbound PSTN call, if a Twilio
 * number is configured to point here). Serves the greeting, then <Gather>s
 * the first caller utterance. Subsequent turns are handled by /api/process-speech.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const twiml = new VoiceResponse();
  const publicUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  const callSid = String(req.body?.CallSid ?? req.query?.CallSid ?? '');
  const from = String(req.body?.From ?? req.query?.From ?? '');
  // Voice SDK connect params come through as query params on POST body
  const claimedCaller = String(
    req.body?.phoneNumber ?? req.query?.phoneNumber ?? '',
  );
  const callerPhone = claimedCaller && claimedCaller.startsWith('+') ? claimedCaller : from;

  // Stream real-time transcripts to the /call page's live panel
  if (publicUrl) {
    twiml.start().transcription({
      statusCallbackUrl: `${publicUrl}/api/transcription`,
      track: 'both_tracks',
      partialResults: true,
    });
  }

  // Kick off a Twilio call recording so /api/recording-status can hand it
  // to Conversational Intelligence when the call ends. Fire-and-forget.
  if (callSid && publicUrl) {
    getTwilioClient()
      .calls(callSid)
      .recordings.create({
        recordingStatusCallback: `${publicUrl}/api/recording-status`,
        recordingStatusCallbackEvent: ['completed'],
        recordingChannels: 'dual',
      })
      .catch((err) => console.warn('[voice] recording.create failed:', err?.message ?? err));
  }

  // Ask the agent for its opening line
  let opening = '';
  try {
    opening = await greeting(callSid || `call_${Date.now()}`, callerPhone);
  } catch (err) {
    console.error('[voice] greeting failed:', err);
    opening =
      "Hi, thanks for calling Bay Area Learning Center. I'm having trouble reaching our system right now — please try again in a moment.";
  }

  twiml.say({ voice: AGENT_VOICE }, opening);

  const gather = twiml.gather({
    input: ['speech'],
    action: publicUrl ? `${publicUrl}/api/process-speech` : '/api/process-speech',
    method: 'POST',
    speechTimeout: 'auto',
    speechModel: 'experimental_conversations',
    enhanced: true,
    language: 'en-US',
  });
  gather.pause({ length: 1 });

  // If the caller says nothing, reprompt once and then end
  twiml.say(
    { voice: AGENT_VOICE },
    "I didn't catch that. Please give me a moment and try again.",
  );
  twiml.redirect({ method: 'POST' }, publicUrl ? `${publicUrl}/api/voice` : '/api/voice');

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}
