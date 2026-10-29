import Layout from '../components/Layout';
import styles from '../styles/Layout.module.css';

// Chip kinds mirror the legend rendered below: required, extra, feature/non-Twilio.
type ChipKind = 'required' | 'extra' | 'feature';

interface Chip {
  label: string;
  kind: ChipKind;
}

const req = (label: string): Chip => ({ label, kind: 'required' });
const extra = (label: string): Chip => ({ label, kind: 'extra' });
const feature = (label: string): Chip => ({ label, kind: 'feature' });

const DEMO_FLOW: { title: string; chips: Chip[] }[] = [
  {
    title: 'Webinar attendee opens a voice call',
    chips: [req('Programmable Voice'), feature('Twilio number or browser (Voice SDK)')],
  },
  {
    title: 'Agent checks for an existing session with the host',
    chips: [
      req('Conversation Relay'),
      req('Conversation Orchestrator'),
      feature('caller matched by phone number'),
      feature('GPT-4o tool call → Airtable'),
      feature('reschedule if booked, offer times if not'),
    ],
  },
  {
    title: '“Keep it or reschedule?”',
    chips: [
      req('Conversation Relay'),
      feature('speech-to-text + text-to-speech'),
      feature('answers in the caller’s language'),
    ],
  },
  {
    title: 'New times sent by RCS',
    chips: [
      req('RCS'),
      req('Programmable Messaging'),
      feature('Content Template, 3 tap options'),
      feature('SMS fallback via Messaging Service'),
    ],
  },
  {
    title: 'Tap lands on the live call',
    chips: [
      req('Conversation Orchestrator'),
      feature('call + RCS in one conversation'),
      feature('agent confirms aloud'),
    ],
  },
  {
    title: 'Ops watches live, reviews after',
    chips: [
      req('Conversation Intelligence'),
      feature('live transcript'),
      feature('Sentiment operator'),
      feature('PII redaction, text + audio'),
    ],
  },
];

type Tier = 'crawl' | 'walk' | 'run';

interface UseCase {
  category: string;
  title: string;
  description: string;
  demoTier: Tier;
  crawl: Chip[];
  walk: Chip[];
  run: Chip[];
}

const USE_CASES: UseCase[] = [
  {
    category: 'Core',
    title: 'Appointment Scheduling & Rescheduling',
    description: 'Reschedule by phone, pick a new time from an RCS text, confirm with a tap.',
    demoTier: 'run',
    crawl: [req('Programmable Messaging'), extra('Studio')],
    walk: [req('Programmable Voice'), req('RCS'), extra('Programmable Video'), extra('Twilio Sync')],
    run: [
      req('Conversation Relay'),
      req('Conversation Orchestrator'),
      extra('Conversation Memory'),
      extra('Enterprise Knowledge'),
    ],
  },
  {
    category: 'How it’s delivered',
    title: 'Multi-Channel Inbound Self-Service & IVR/IVA',
    description:
      'AI agent answers, finds the student’s record, and resolves the request without staff.',
    demoTier: 'walk',
    crawl: [
      extra('Studio'),
      req('Conversation Intelligence'),
      req('Programmable Messaging'),
      extra('Elastic SIP Trunking'),
    ],
    walk: [
      req('Conversation Relay'),
      req('Conversation Orchestrator'),
      req('Programmable Voice'),
      extra('Messaging - Software'),
      extra('Twilio Sync'),
      feature('Text to Speech — in Relay'),
    ],
    run: [extra('Enterprise Knowledge'), extra('Conversation Memory'), extra('Voice Insights')],
  },
  {
    category: 'How the channels connect',
    title: 'Persistent Conversations & Contextual History',
    description:
      'The call and the RCS tap are one conversation, so the agent knows the tap landed while the student is still on the line.',
    demoTier: 'walk',
    crawl: [extra('Studio'), req('Programmable Messaging')],
    walk: [
      req('Conversation Relay'),
      req('Conversation Orchestrator'),
      req('Programmable Voice'),
      extra('Messaging - Software'),
    ],
    run: [extra('Conversation Memory'), extra('Segment'), req('Conversation Intelligence')],
  },
  {
    category: 'How it’s governed',
    title: 'Real-Time Observability & Compliance Monitoring',
    description:
      'Live transcript during the call; after it, the transcript, sentiment, and PII redacted from text and audio.',
    demoTier: 'walk',
    crawl: [req('Programmable Voice'), extra('Voice Insights')],
    walk: [req('Conversation Intelligence'), extra('Flex')],
    run: [
      extra('Conversation Memory'),
      req('Conversation Intelligence'),
      extra('Enterprise Knowledge'),
      extra('Editions'),
    ],
  },
];

const TIERS: Tier[] = ['crawl', 'walk', 'run'];

const CHIP_CLASS: Record<ChipKind, string> = {
  required: styles.ucChipRequired,
  extra: styles.ucChipExtra,
  feature: styles.ucChipFeature,
};

function ChipList({ chips }: { chips: Chip[] }) {
  return (
    <div className={styles.ucChips}>
      {chips.map((chip) => (
        <span key={chip.label} className={`${styles.ucChip} ${CHIP_CLASS[chip.kind]}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

export default function UseCasesPage() {
  return (
    <Layout
      title="Use Case Details"
      subtitle="What the reschedule demo runs on — the Bay Area Learning Center voice + RCS agent, mapped to the Twilio use-case catalog."
    >
      <div className={styles.grid}>
        <div className={styles.ucStats}>
          <div className={styles.ucStat}>
            <span className={styles.ucStatValue}>4</span> use cases demonstrated
          </div>
          <div className={styles.ucStat}>
            <span className={styles.ucStatValue}>6</span> Twilio products run it
          </div>
          <div className={styles.ucStat}>
            <span className={styles.ucStatValue}>11</span> more across Crawl / Walk / Run
          </div>
        </div>

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>The demo flow — and what each step runs on</h2>
          <div className={styles.flow}>
            {DEMO_FLOW.map((step, i) => (
              <div key={step.title} className={styles.flowStep}>
                <span className={styles.flowStepNumber}>{i + 1}</span>
                <div className={styles.flowStepTitle}>{step.title}</div>
                <ChipList chips={step.chips} />
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>Use cases demonstrated</h2>
          <p className={styles.helper} style={{ margin: '0 0 12px' }}>
            Product lists per tier are the catalog’s own.
          </p>
          <div className={styles.ucLegend}>
            <span className={`${styles.ucChip} ${styles.ucChipRequired}`}>Required for the demo</span>
            <span className={`${styles.ucChip} ${styles.ucChipExtra}`}>Extra</span>
            <span className={`${styles.ucChip} ${styles.ucChipFeature}`}>
              Feature or non-Twilio component
            </span>
            <span className={styles.ucLegendDemo}>Where the demo lands</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.ucTable}`}>
              <thead>
                <tr>
                  <th>Use case</th>
                  <th>Crawl</th>
                  <th>Walk</th>
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                {USE_CASES.map((uc) => (
                  <tr key={uc.title}>
                    <td>
                      <div className={styles.ucCategory}>{uc.category}</div>
                      <div className={styles.ucTitle}>{uc.title}</div>
                      <div className={styles.ucDescription}>{uc.description}</div>
                    </td>
                    {TIERS.map((tier) => {
                      const isDemo = uc.demoTier === tier;
                      return (
                        <td key={tier} className={isDemo ? styles.ucDemoCell : undefined}>
                          {isDemo && <div className={styles.ucDemoTag}>Demo</div>}
                          <ChipList chips={uc[tier]} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
}
