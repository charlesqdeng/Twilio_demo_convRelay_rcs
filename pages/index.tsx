import Link from 'next/link';
import Layout from '../components/Layout';
import styles from '../styles/Layout.module.css';

const FLOW = [
  {
    title: 'Customer calls',
    body: 'A caller reaches the AI voice agent at your Twilio number.',
  },
  {
    title: 'Agent looks them up',
    body: 'The agent calls its getAirtableData tool against the shared Appointments table and greets the caller by name with their current appointment.',
  },
  {
    title: '"Keep or reschedule?"',
    body: 'The agent confirms the existing time. If the caller says keep, it closes the loop and updates status.',
  },
  {
    title: 'RCS quick-reply offer',
    body: 'If the caller wants to reschedule, the agent calls its sendRCS tool with 3 candidate slots — the caller confirms a new time with a single tap.',
  },
  {
    title: 'Airtable updates',
    body: 'A tap posts back to this app’s /api/rcs-inbound webhook, which writes the chosen time and status back to Airtable.',
  },
];

export default function OverviewPage() {
  return (
    <Layout
      title="Overview"
      subtitle="An ops dashboard for the appointment voice agent. Voice happens on the agent; Airtable, RCS delivery, and the reschedule flow live here."
    >
      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardHeading}>What this demo shows</h2>
          <div className={styles.cardBody}>
            <p>
              The <strong>Betwext Conversation AI Demo</strong> is an AI voice agent that helps
              service customers manage their appointments. When a customer calls, the agent
              greets them by name, confirms their appointment, and — if they want a different
              time — sends an <strong>RCS quick-reply</strong> so they can confirm a new slot
              with a single tap.
            </p>
            <p>
              This Next.js app is the operations dashboard. It reads and writes the same
              Airtable base the voice agent uses, so records stay in sync. The voice agent
              itself is configured separately — see the Voice Agent Setup page for the exact
              prompt, tools, and Content SID it expects.
            </p>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>Flow</h2>
          <div className={styles.flow}>
            {FLOW.map((step, i) => (
              <div key={step.title} className={styles.flowStep}>
                <span className={styles.flowStepNumber}>{i + 1}</span>
                <div className={styles.flowStepTitle}>{step.title}</div>
                <div className={styles.flowStepBody}>{step.body}</div>
              </div>
            ))}
          </div>
        </section>

        <div className={`${styles.grid} ${styles.gridCols2}`}>
          <section className={styles.card}>
            <h2 className={styles.cardHeading}>Try the dashboard</h2>
            <div className={styles.cardBody}>
              <p>
                Head to <Link href="/appointments">Appointments</Link> to view records, add a
                test appointment, or manually trigger an RCS quick-reply offer against a real
                phone number to test the confirm-by-tap experience.
              </p>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardHeading}>Wire up the voice agent</h2>
            <div className={styles.cardBody}>
              <p>
                <Link href="/voice-agent-setup">Voice Agent Setup</Link> has the exact
                Instructions/Prompt text to paste into your voice agent, the list of tools to
                enable, the Airtable schema reference, and a button to fetch or create the
                Twilio Content SID for the reschedule quick-reply message.
              </p>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardHeading}>Talk to the agent from your browser</h2>
            <div className={styles.cardBody}>
              <p>
                <Link href="/call">Call Agent</Link> uses the Twilio Voice SDK to dial the
                Bay Area Honda Service agent — which runs <strong>inline</strong> in this
                Next.js app, driven by GPT-4o with function calling for Airtable lookups,
                appointment updates, and RCS quick-replies. Pick which appointment to call
                as, watch the live transcript stream in, and after you hang up review the
                post-call Twilio Conversational Intelligence transcript with PII redaction
                and side-by-side original / redacted audio playback.
              </p>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
