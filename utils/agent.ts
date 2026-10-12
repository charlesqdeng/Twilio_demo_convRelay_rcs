import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import {
  findByPhone,
  getAppointment,
  updateAppointment,
} from './airtableAppointments';
import { sendRescheduleOffer } from './reschedule';
import type { Appointment } from './types';

// ---- Conversation state ---------------------------------------------------

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface CallState {
  messages: ChatMessage[];
  callerPhone: string;
  pinnedAppointment: Appointment | null;
  updatedAt: number;
}

const g = globalThis as unknown as { __betwext_calls?: Map<string, CallState> };
if (!g.__betwext_calls) g.__betwext_calls = new Map();
const CALLS: Map<string, CallState> = g.__betwext_calls;

function pruneOld() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  const toDelete: string[] = [];
  CALLS.forEach((state, sid) => {
    if (state.updatedAt < cutoff) toDelete.push(sid);
  });
  for (const sid of toDelete) CALLS.delete(sid);
}

// ---- Prompt loading -------------------------------------------------------

let cachedSystemPrompt: string | null = null;
function systemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const dir = path.join(process.cwd(), 'prompts');
  const prompt = fs.readFileSync(path.join(dir, 'agent-prompt.md'), 'utf-8');
  const instructions = fs.readFileSync(path.join(dir, 'agent-instructions.md'), 'utf-8');
  cachedSystemPrompt = [
    prompt,
    '',
    '---',
    '',
    instructions,
    '',
    '---',
    '',
    'Runtime notes for the inline agent:',
    '- Use the provided tools instead of describing them. Never mention "sendRCS" or contentSid to the caller.',
    '- When you decide to send new times, call the send_reschedule_rcs tool with the caller\'s appointment_id.',
    '- Speak in short, natural sentences — every response is spoken aloud, so avoid symbols, markdown, or lists.',
    '- Spell out times like "ten AM" or "two thirty PM" when speaking.',
    '- If the caller wants to end the call, respond briefly and then end.',
    '- Do NOT read out the phone number, record id, or any internal identifiers.',
  ].join('\n');
  return cachedSystemPrompt;
}

// ---- Tool definitions -----------------------------------------------------

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'find_appointment_by_phone',
      description:
        'Look up the caller\'s current appointment in Airtable by their phone number (E.164). Returns the appointment record if found.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'Caller phone number in E.164 format (e.g. +15555550100).',
          },
        },
        required: ['phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_appointment',
      description:
        'Update an existing appointment record. Use to set status (e.g. Confirmed after the caller says they\'ll keep their existing time) or to move to a new date/time if the caller picks one on the call.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'Airtable record id from find_appointment_by_phone.' },
          status: {
            type: 'string',
            enum: ['Scheduled', 'Confirmed', 'Rescheduled', 'Cancelled'],
            description: 'New status.',
          },
          appointment_time_iso: {
            type: 'string',
            description: 'New appointment time as an ISO-8601 string. Only include when moving to a new time.',
          },
        },
        required: ['appointment_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_reschedule_rcs',
      description:
        'Send the caller an RCS quick-reply text message with three new available date/time options they can tap to confirm. Use when the caller wants to reschedule but does not name a specific time on the call.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'Airtable record id from find_appointment_by_phone.' },
        },
        required: ['appointment_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'End the phone call politely. Use once the conversation is naturally complete.',
      parameters: {
        type: 'object',
        properties: {
          farewell: { type: 'string', description: 'A short spoken farewell (1 sentence).' },
        },
        required: ['farewell'],
      },
    },
  },
];

// ---- Tool handlers --------------------------------------------------------

async function runTool(
  name: string,
  args: Record<string, unknown>,
  state: CallState,
): Promise<{ result: string; shouldHangUp?: boolean; farewell?: string }> {
  if (name === 'find_appointment_by_phone') {
    const phone = String(args.phone ?? state.callerPhone ?? '');
    const appt = await findByPhone(phone);
    if (!appt) {
      return {
        result: JSON.stringify({ found: false, phone }),
      };
    }
    state.pinnedAppointment = appt;
    return {
      result: JSON.stringify({
        found: true,
        appointment: {
          id: appt.id,
          student_name: appt.customerName,
          course: appt.serviceType,
          cohort: appt.vehicle,
          location: appt.location,
          session_time_iso: appt.appointmentTime,
          status: appt.status,
        },
      }),
    };
  }

  if (name === 'update_appointment') {
    const id = String(args.appointment_id ?? state.pinnedAppointment?.id ?? '');
    if (!id) return { result: JSON.stringify({ ok: false, error: 'missing appointment_id' }) };
    const patch: Record<string, unknown> = {};
    if (typeof args.status === 'string') patch.status = args.status;
    if (typeof args.appointment_time_iso === 'string')
      patch.appointmentTime = args.appointment_time_iso;
    const updated = await updateAppointment(id, patch as any);
    return {
      result: JSON.stringify({ ok: Boolean(updated), appointment_id: id, patch }),
    };
  }

  if (name === 'send_reschedule_rcs') {
    const id = String(args.appointment_id ?? state.pinnedAppointment?.id ?? '');
    const appt = state.pinnedAppointment ?? (id ? await getAppointment(id) : null);
    if (!appt) return { result: JSON.stringify({ ok: false, error: 'appointment not found' }) };
    try {
      const r = await sendRescheduleOffer(appt);
      return {
        result: JSON.stringify({
          ok: true,
          message_sid: r.messageSid,
          proposed_labels: r.proposedLabels,
        }),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { result: JSON.stringify({ ok: false, error: msg }) };
    }
  }

  if (name === 'end_call') {
    const farewell = typeof args.farewell === 'string' ? args.farewell : 'Thanks for calling. Goodbye!';
    return { result: JSON.stringify({ ok: true }), shouldHangUp: true, farewell };
  }

  return { result: JSON.stringify({ ok: false, error: `unknown tool ${name}` }) };
}

// ---- Public API -----------------------------------------------------------

let cachedClient: OpenAI | null = null;
function openai(): OpenAI {
  if (!cachedClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return cachedClient;
}

export interface AgentTurn {
  spoken: string;
  shouldHangUp: boolean;
}

export function initializeCall(callSid: string, callerPhone: string): CallState {
  pruneOld();
  const state: CallState = {
    messages: [{ role: 'system', content: systemPrompt() }],
    callerPhone,
    pinnedAppointment: null,
    updatedAt: Date.now(),
  };
  CALLS.set(callSid, state);
  return state;
}

export function getCallState(callSid: string): CallState | null {
  return CALLS.get(callSid) ?? null;
}

export function endCall(callSid: string) {
  CALLS.delete(callSid);
}

/**
 * Runs one conversational turn. Feeds the caller utterance into GPT-4o,
 * lets it call tools iteratively, and returns the final spoken response
 * plus whether the call should hang up.
 */
export async function runAgentTurn(
  callSid: string,
  userUtterance: string,
): Promise<AgentTurn> {
  let state = CALLS.get(callSid);
  if (!state) state = initializeCall(callSid, '');
  state.updatedAt = Date.now();

  if (userUtterance) {
    state.messages.push({ role: 'user', content: userUtterance });
  }

  let shouldHangUp = false;
  let farewellOverride: string | null = null;

  const client = openai();

  // Iterate on tool calls until the model returns a plain assistant message
  for (let iter = 0; iter < 6; iter++) {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      messages: state.messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.4,
    });

    const choice = completion.choices[0];
    const assistantMessage = choice.message;
    state.messages.push(assistantMessage);

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return { spoken: assistantMessage.content ?? '', shouldHangUp };
    }

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const outcome = await runTool(call.function.name, args, state);
      state.messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: outcome.result,
      });
      if (outcome.shouldHangUp) {
        shouldHangUp = true;
        if (outcome.farewell) farewellOverride = outcome.farewell;
      }
    }

    if (shouldHangUp && farewellOverride) {
      return { spoken: farewellOverride, shouldHangUp: true };
    }
  }

  return {
    spoken: "I'm having trouble processing that — let me have a team member follow up. Goodbye!",
    shouldHangUp: true,
  };
}

/**
 * The agent's opening line. If the caller phone matches an appointment we
 * greet by name; otherwise fall back to a generic greeting that asks for
 * their phone number.
 */
export async function greeting(callSid: string, callerPhone: string): Promise<string> {
  initializeCall(callSid, callerPhone);
  const state = CALLS.get(callSid)!;

  // Seed by looking up the caller if we have a phone number
  let seededContext = '';
  if (callerPhone && callerPhone.startsWith('+')) {
    const appt = await findByPhone(callerPhone);
    if (appt) {
      state.pinnedAppointment = appt;
      seededContext = `The caller's phone number is ${callerPhone}. Their enrollment on file is: id=${appt.id}, name=${appt.customerName}, course=${appt.serviceType}, cohort=${appt.vehicle ?? 'n/a'}, session_time_iso=${appt.appointmentTime}, status=${appt.status}.`;
    } else {
      seededContext = `The caller's phone number is ${callerPhone}, but no enrollment was found on file for that number.`;
    }
  } else {
    seededContext = `The caller does not have a resolvable phone number (they're calling from a browser client). Politely ask them to say their phone number so you can look up their enrollment.`;
  }

  state.messages.push({
    role: 'system',
    content: `Context for this call: ${seededContext}\n\nOpen with a warm greeting thanking them for calling Bay Area Learning Center. If we already have their enrollment on file, greet them by first name and read back their course and session details, then ask whether they want to keep it or reschedule. If we do not, ask them to say their phone number.`,
  });

  const turn = await runAgentTurn(callSid, '');
  return turn.spoken;
}
