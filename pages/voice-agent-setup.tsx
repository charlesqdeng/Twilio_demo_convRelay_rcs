import fs from 'fs';
import path from 'path';
import type { GetStaticProps } from 'next';
import { useState } from 'react';
import Layout from '../components/Layout';
import styles from '../styles/Layout.module.css';

interface Props {
  instructionsText: string;
  promptText: string;
}

interface ContentSidResponse {
  contentSid: string;
  isNew: boolean;
  source: 'env' | 'lookup' | 'created';
  friendlyName: string;
  templateBody: string;
}

const AGENT_TOOLS: Array<{ name: string; description: string; config: string[] }> = [
  {
    name: 'getAirtableData',
    description: 'Look up the caller by phone number and read their current appointment.',
    config: [
      'Airtable Base ID = AIRTABLE_BASE_ID',
      'Table = value of AIRTABLE_APPOINTMENTS_TABLE (default: Appointments)',
      'Airtable API Key = AIRTABLE_API_KEY',
    ],
  },
  {
    name: 'upsertAirtableData',
    description:
      'Write the appointment back — status to Confirmed on keep, or a new AppointmentTime + status Rescheduled when the caller picks a new slot on the call.',
    config: [
      'Point at the same base/table as getAirtableData',
      'Uses PhoneNumber as the match key',
    ],
  },
  {
    name: 'sendRCS',
    description:
      'Send the reschedule quick-reply. The agent supplies the reschedule Content SID (see step 4 below) and contentVariables {1: firstName, 2/3/4: slot labels}.',
    config: [
      'Messaging Service SID (Environment Override) = TWILIO_MESSAGING_SERVICE_SID',
      'No separate Content SID field — the agent passes it per call',
    ],
  },
];

const SCHEMA: Array<{ field: string; type: string; purpose: string }> = [
  { field: 'CustomerName', type: 'Single line text', purpose: 'First-name greeting.' },
  {
    field: 'Phone',
    type: 'Phone number (E.164)',
    purpose: 'Primary lookup for getAirtableData and the /api/rcs-inbound tap handler.',
  },
  { field: 'Service', type: 'Single line text', purpose: 'e.g. Oil Change, 30,000 Mile Service.' },
  { field: 'Vehicle', type: 'Single line text', purpose: 'e.g. 2022 Honda Civic.' },
  { field: 'Location', type: 'Single line text', purpose: 'Service center name.' },
  { field: 'Date', type: 'Date', purpose: 'Appointment date (yyyy-mm-dd).' },
  { field: 'Time', type: 'Single line text', purpose: 'Appointment time (e.g. "10:00 AM").' },
  {
    field: 'Status',
    type: 'Single select',
    purpose: 'scheduled / confirmed / rescheduled / cancelled (lowercase in Airtable).',
  },
  {
    field: 'OfferedSlots',
    type: 'Long text (JSON)',
    purpose: 'Populated when a reschedule offer is sent — resolves a tap to a specific slot.',
  },
  { field: 'Notes', type: 'Long text', purpose: 'Free-form (optional).' },
];

export const getStaticProps: GetStaticProps<Props> = async () => {
  const promptsDir = path.join(process.cwd(), 'prompts');
  const instructionsText = fs.readFileSync(
    path.join(promptsDir, 'agent-instructions.md'),
    'utf-8',
  );
  const promptText = fs.readFileSync(path.join(promptsDir, 'agent-prompt.md'), 'utf-8');
  return { props: { instructionsText, promptText } };
};

function CopyPreCard({
  title,
  helper,
  body,
}: {
  title: string;
  helper: string;
  body: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <section className={styles.card}>
      <h2 className={styles.cardHeading}>{title}</h2>
      <div className={styles.copyRow}>
        <p className={styles.helper}>{helper}</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {copied && <span className={styles.copyStatus}>Copied!</span>}
          <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={copy}>
            Copy
          </button>
        </div>
      </div>
      <pre className={styles.pre}>{body}</pre>
    </section>
  );
}

export default function VoiceAgentSetupPage({ instructionsText, promptText }: Props) {
  const [busy, setBusy] = useState(false);
  const [contentSidState, setContentSidState] = useState<ContentSidResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchContentSid = async (forceLookup = false) => {
    setBusy(true);
    setError(null);
    try {
      const url = forceLookup ? '/api/content-sid?refresh=1' : '/api/content-sid';
      const res = await fetch(url);
      const body = (await res.json()) as ContentSidResponse | { error: string };
      if (!res.ok) throw new Error('error' in body ? body.error : `HTTP ${res.status}`);
      setContentSidState(body as ContentSidResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout
      title="Voice Agent Setup"
      subtitle="Everything you need to configure the Bay Area Honda Service AI voice agent — the tools it uses, the Airtable schema, the exact prompt text, and the reschedule Content SID."
    >
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardHeading}>1. Enable these tools on the voice agent</h2>
          <ul className={styles.checklist}>
            {AGENT_TOOLS.map((tool) => (
              <li key={tool.name} className={styles.checkItem}>
                <span className={styles.checkDot} />
                <div>
                  <div>
                    <code className={styles.inlineCode}>{tool.name}</code> — {tool.description}
                  </div>
                  <ul style={{ margin: '6px 0 0 18px', color: '#64748b', fontSize: 13 }}>
                    {tool.config.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>2. Airtable schema (Appointments table)</h2>
          <p className={styles.helper}>
            Table name comes from the{' '}
            <code className={styles.inlineCode}>AIRTABLE_APPOINTMENTS_TABLE</code> env var
            (default: <code className={styles.inlineCode}>Appointments</code>).
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {SCHEMA.map((row) => (
                  <tr key={row.field}>
                    <td>
                      <code className={styles.inlineCode}>{row.field}</code>
                    </td>
                    <td>{row.type}</td>
                    <td>{row.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <CopyPreCard
          title="3a. Prompt (Background & Goal)"
          helper="Paste this into the Prompt / Background field of your voice agent."
          body={promptText}
        />

        <CopyPreCard
          title="3b. Instructions"
          helper="Paste this into the Instructions field of the same voice agent. It references your reschedule Content SID and the {1: firstName, 2/3/4: slots} variable layout."
          body={instructionsText}
        />

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>4. Reschedule quick-reply Content SID</h2>
          <div className={styles.cardBody}>
            <p>
              Click <strong>Fetch or create by friendly name</strong> to look up (or create)
              the reschedule template on your Twilio account. Once resolved, copy the
              returned <code className={styles.inlineCode}>HX...</code> SID into{' '}
              <code className={styles.inlineCode}>TWILIO_RESCHEDULE_CONTENT_SID</code> in{' '}
              <code className={styles.inlineCode}>.env.local</code> so subsequent sends
              skip the Content API round-trip.
            </p>
          </div>
          <div
            style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}
          >
            <button
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={() => fetchContentSid(true)}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Fetch or create by friendly name'}
            </button>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          {contentSidState && (
            <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
              <div className={styles.contentSidBox}>{contentSidState.contentSid}</div>
              <div className={styles.helper}>
                Source: <strong>{contentSidState.source}</strong> · Friendly name:{' '}
                <code className={styles.inlineCode}>{contentSidState.friendlyName}</code>
                {contentSidState.isNew && ' · newly created'}
              </div>
              <div className={styles.helper}>
                Template body: <em>{contentSidState.templateBody}</em>
              </div>
              <div className={styles.helper}>
                Override with{' '}
                <code className={styles.inlineCode}>TWILIO_RESCHEDULE_CONTENT_SID</code> in{' '}
                <code className={styles.inlineCode}>.env.local</code> to point this app at a
                different template.
              </div>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
}
