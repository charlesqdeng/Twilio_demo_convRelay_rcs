import type { NextApiRequest, NextApiResponse } from 'next';
import Twilio from 'twilio';
import { endCall, runAgentTurn } from '../../utils/agent';

const VoiceResponse = Twilio.twiml.VoiceResponse;
const AGENT_VOICE = 'Polly.Joanna-Neural';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const twiml = new VoiceResponse();
  const publicUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  const callSid = String(req.body?.CallSid ?? '');
  const speech = String(req.body?.SpeechResult ?? '').trim();

  if (!callSid) {
    twiml.say({ voice: AGENT_VOICE }, "Sorry, we lost track of that call.");
    twiml.hangup();
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(twiml.toString());
  }

  let spoken = '';
  let hangUp = false;
  try {
    const turn = await runAgentTurn(callSid, speech || '(caller was silent)');
    spoken = turn.spoken;
    hangUp = turn.shouldHangUp;
  } catch (err) {
    console.error('[process-speech] agent turn failed:', err);
    spoken =
      "I'm having trouble processing that right now. A team member will follow up with you shortly. Thanks for calling!";
    hangUp = true;
  }

  if (spoken) twiml.say({ voice: AGENT_VOICE }, spoken);

  if (hangUp) {
    endCall(callSid);
    twiml.hangup();
  } else {
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

    // If no speech was captured within the gather, gently re-prompt then hang up
    twiml.say(
      { voice: AGENT_VOICE },
      "It sounds like you may have stepped away. I'll let you go — have a great day!",
    );
    twiml.hangup();
  }

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
}
