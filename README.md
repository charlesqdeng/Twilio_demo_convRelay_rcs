# Betwext Conversation AI Demo

An AI voice agent (Bay Area Learning Center) that helps students reschedule their enrolled course sessions.

## What it does

- When a student calls, the agent looks up their current enrollment by phone number and greets them by name.
- The agent reads back the course they're enrolled in and the current session date/time, and asks whether they'd like to keep it or reschedule.
- If the caller wants to reschedule, the agent sends an **RCS quick-reply text message** with 2–3 new available date/time options — the caller can tap a button to confirm, or state their preferred time on the call.
- Enrollment data is stored in Airtable, shared between the voice agent's tools and this app's dashboard.

## This app

This Next.js app is an operations dashboard for the demo:

- **Overview** — explains the course rescheduling flow.
- **Enrollments** — view and manage enrollment records (backed by Airtable, with a local fallback so the demo always works), add test enrollments with a real phone number, and manually trigger a "new times" RCS quick-reply offer to test the confirm-by-tap experience.
- **Voice Agent Setup** — copyable Instructions/Prompt text for the voice agent, notes on which tools to enable (`getAirtableData`, `upsertAirtableData`, `sendRCS`), and a button to fetch/create the Content SID for the reschedule quick-reply message template.
- **Call Agent** — dial the Bay Area Learning Center voice agent from the browser via the Twilio Voice SDK. The agent runs **inline in this Next.js app** — GPT-4o drives the conversation with function calling for Airtable lookups, enrollment updates, and RCS quick-replies (see [utils/agent.ts](utils/agent.ts)). Pick which enrollment to call as (impersonates that phone number so the agent looks them up by name), watch the live transcript stream in during the call, and review the post-call Twilio Conversational Intelligence transcript with PII redaction and side-by-side original / redacted audio playback.

## Setup

1. Install dependencies and copy the env template:

   ```bash
   npm install
   cp .env.example .env.local
   # edit .env.local — Twilio + Airtable + Messaging Service SID
   ```

2. Start the app (Next.js on port 3030 + ngrok tunnel):

   ```bash
   npm run launch          # macOS / Linux
   npm run launch:windows  # Windows
   ```

   Or start the dev server alone:

   ```bash
   npm run dev
   ```

3. Provision the Twilio TwiML App used by the browser-dial page:

   ```bash
   npm run provision-twiml
   ```

   This creates (or updates) a TwiML App on your Twilio account whose Voice URL points at `${NEXT_PUBLIC_APP_URL}/api/voice`, then writes the new `TWILIO_TWIML_APP_SID` back into `.env.local`. Rerun any time `NEXT_PUBLIC_APP_URL` changes.

4. Provision a dedicated Twilio Messaging Service so quick-reply taps can flow back into Airtable:

   ```bash
   npm run provision-msg                          # creates the service, points inbound at /api/rcs-inbound
   npm run add-sender -- +1XXXXXXXXXX             # attach a sender (safety-checked: refuses to steal a shared number)
   ```

   IMPORTANT: use a phone number that isn't already in a teammate's shared Messaging Service — the `add-sender` script refuses in that case. If you skip this step the app can still SEND RCS offers through whatever `TWILIO_MESSAGING_SERVICE_SID` is currently set to, but taps won't route to `/api/rcs-inbound` and Airtable won't auto-update on the caller's response.

5. Create the reschedule Content template: open the app at `http://localhost:3030/voice-agent-setup` and click **Fetch or create by friendly name** under section 4. Copy the returned `HX...` SID into `.env.local` as `TWILIO_RESCHEDULE_CONTENT_SID`. (Optional but avoids a Content API round-trip on every send.)

6. (External voice agent path only — this repo's default is the inline agent) If you want to run the agent on an external platform instead, the **Voice Agent Setup** page has two copyable blocks (Prompt / Instructions) you can paste in, plus the schema and Content SID reference. Enable `getAirtableData`, `upsertAirtableData`, and `sendRCS` on that external agent, pointed at the same Airtable base and the same Messaging Service.

## About RCS delivery

Messages send through `TWILIO_MESSAGING_SERVICE_SID` by default rather than a bare phone number, since RCS eligibility is resolved at the Messaging Service level in Twilio — sending from a raw number will always fall back to plain SMS. If `RCS_FROM_NUMBER` is set to an RCS sender ID (starts with `rcs:`, e.g. `rcs:your_agent_sender`), it takes priority and forces RCS-only delivery (no SMS fallback) — the recipient number is automatically prefixed with `rcs:` too, since Twilio requires both sides prefixed for this pattern. Twilio still automatically falls back to SMS per-message when using a Messaging Service and the recipient isn't RCS-capable, which is expected and not an error. To actually see the RCS quick-reply UI, test with a real personal mobile number (ideally Android with Google Messages/RCS enabled) — sending to another Twilio-owned number will never show as RCS since it isn't a real handset.

## Airtable schema (`Appointments` table)

The underlying Airtable columns are unchanged from the previous Honda scenario — only their *semantic meaning* has shifted. `Service` now holds a course name, `Vehicle` now holds a cohort/section label.

| Field | Type | Purpose |
|---|---|---|
| `CustomerName` | Single line text | Student name (greeting) |
| `Phone` | Phone number (E.164) | Primary lookup — used by the agent's `getAirtableData` and the inbound RCS handler |
| `Service` | Single line text | Course name, e.g. "Intro to Python", "SAT Prep" |
| `Vehicle` | Single line text | Cohort/section, e.g. "Spring 2026 Evening" (optional) |
| `Location` | Single line text | Campus or room name |
| `Date` | Date | Session date (yyyy-mm-dd) |
| `Time` | Single line text | Session time (e.g. "10:00 AM") |
| `Status` | Single select | `scheduled` / `confirmed` / `rescheduled` / `cancelled` (lowercase) |
| `OfferedSlots` | Long text (JSON) | Set when a reschedule offer is sent; used to resolve a quick-reply tap |
| `Notes` | Long text | Free-form (optional) |

When any Airtable env var is missing (or the Airtable API errors), the app transparently falls back to an in-memory store seeded with two demo records, so the dashboard always renders and the "Send Reschedule Options" flow still exercises Twilio.

## Environment variables

See [.env.example](.env.example) for the full list. The two most commonly missed:

- `TWILIO_MESSAGING_SERVICE_SID` — required to send RCS/SMS via this app.
- `TWILIO_RESCHEDULE_CONTENT_SID` — optional cache. If unset, the app looks up (or creates) a template on your account by friendly name (`betwext_reschedule_options_v1`) on every send. Set this to the `HX...` SID after the first create to skip the round-trip. Note: for launched RBM senders, the template must be submitted for Google approval before it renders as interactive RCS.

## API surface

- `GET /api/appointments` — list all appointments; returns `{ source: 'airtable' | 'local', appointments: [...] }`.
- `POST /api/appointments` — create.
- `PATCH /api/appointments/[id]`, `DELETE /api/appointments/[id]` — update / delete.
- `POST /api/send-reschedule` — accepts `{ appointmentId }`, generates 3 slots, resolves the Content SID, sends the RCS quick-reply through Twilio, and writes the proposed slots back onto the record.
- `GET /api/content-sid` — returns the reschedule Content SID (creates it if missing).
- `POST /api/rcs-inbound` — Twilio Messaging Service inbound webhook. Matches the sender's `From` to an appointment, matches the `Body` to one of the previously proposed slots (by index or label), and writes `AppointmentTime` + `Status = "Rescheduled"` back to Airtable.
