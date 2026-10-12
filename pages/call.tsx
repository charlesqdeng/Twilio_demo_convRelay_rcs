import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import Layout from '../components/Layout';
import styles from '../styles/Layout.module.css';
import type { Appointment } from '../utils/types';

type DeviceStatus =
  | 'initializing'
  | 'ready'
  | 'connecting'
  | 'live'
  | 'disconnecting'
  | 'ended'
  | 'error';

interface TranscriptLine {
  speaker: 'AGENT' | 'CALLER';
  text: string;
  isFinal: boolean;
  timestamp: number;
  ephemeralKey?: string;
}

interface RecordingSummary {
  status: 'not_ready' | 'in_progress' | 'queued' | 'completed' | string;
  transcriptSid?: string;
  recordingSid?: string;
  recordingUrl?: string;
  redactedMediaUrl?: string;
  fullTranscript?: string;
  piiEntities?: Array<{ type: string; value: string; confidence: number }>;
  piiCount?: number;
  piiTypes?: string[];
  message?: string;
  error?: string;
}

interface CallAnalysis {
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

function statusLabel(s: DeviceStatus): string {
  switch (s) {
    case 'initializing':
      return 'Initializing…';
    case 'ready':
      return 'Ready';
    case 'connecting':
      return 'Connecting…';
    case 'live':
      return 'On call';
    case 'disconnecting':
      return 'Hanging up…';
    case 'ended':
      return 'Call ended';
    case 'error':
      return 'Error';
  }
}

export default function CallPage() {
  const [status, setStatus] = useState<DeviceStatus>('initializing');
  const [statusDetail, setStatusDetail] = useState<string>('Fetching access token…');
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [callSid, setCallSid] = useState<string>('');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [callAsPhone, setCallAsPhone] = useState<string>('');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [pollingRecording, setPollingRecording] = useState(false);
  const [recording, setRecording] = useState<RecordingSummary | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CallAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const analysisRequestedForRef = useRef<string | null>(null);

  const deviceRef = useRef<any>(null);
  const connectionRef = useRef<any>(null);
  const socketRef = useRef<Socket | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // ---- Twilio Voice SDK init ------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setStatusDetail('Fetching access token…');
        const tokenRes = await fetch('/api/token');
        if (!tokenRes.ok) {
          const body = await tokenRes.json().catch(() => ({}));
          throw new Error(body.error ?? `token endpoint returned ${tokenRes.status}`);
        }
        const { token } = (await tokenRes.json()) as { token: string };

        if (cancelled) return;

        const { Device } = await import('@twilio/voice-sdk');
        const device = new Device(token, {
          logLevel: 1,
          codecPreferences: ['opus', 'pcmu'] as any,
        });
        deviceRef.current = device;

        device.on('registered', () => {
          setStatus('ready');
          setStatusDetail('Registered with Twilio. Click Call agent to dial.');
        });
        device.on('error', (err: any) => {
          console.error('[device error]', err);
          setStatus('error');
          setStatusDetail(err?.message ?? String(err));
        });
        device.on('tokenWillExpire', async () => {
          const res = await fetch('/api/token');
          if (res.ok) {
            const { token: refreshed } = await res.json();
            device.updateToken(refreshed);
          }
        });

        await device.register();
      } catch (err) {
        console.error(err);
        setStatus('error');
        setStatusDetail(err instanceof Error ? err.message : String(err));
      }
    })();

    // Load appointments so the caller can pick "Call as" (which phone number
    // the inline agent looks up in Airtable).
    fetch('/api/appointments')
      .then((r) => r.json())
      .then((body: { appointments?: Appointment[] }) => {
        const list = body.appointments ?? [];
        setAppointments(list);
        if (list[0]?.phoneNumber) setCallAsPhone(list[0].phoneNumber);
      })
      .catch((err) => console.warn('[appointments] load failed:', err));

    // Initialize Socket.IO
    fetch('/api/socket')
      .then(() => {
        const socket = io({ path: '/api/socket_io' });
        socket.on('transcript', (msg: TranscriptLine) => {
          setTranscript((prev) => {
            // For non-final lines, replace the most-recent non-final line from the same speaker;
            // for final lines, append.
            if (!msg.isFinal) {
              const withoutStale = prev.filter(
                (line) => line.isFinal || line.speaker !== msg.speaker,
              );
              return [...withoutStale, msg];
            }
            return [...prev.filter((line) => line.isFinal || line.speaker !== msg.speaker), msg];
          });
        });
        socketRef.current = socket;
      })
      .catch((err) => console.warn('[socket] init failed:', err));

    return () => {
      cancelled = true;
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      socketRef.current?.disconnect();
      try {
        deviceRef.current?.destroy();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // ---- Call actions ---------------------------------------------------------
  const beginCall = useCallback(async () => {
    if (!deviceRef.current) return;
    setStatus('connecting');
    setStatusDetail('Placing call…');
    setTranscript([]);
    setRecording(null);
    setRecordingError(null);
    setAnalysis(null);
    setAnalysisError(null);
    analysisRequestedForRef.current = null;
    try {
      const params: Record<string, string> = {};
      if (callAsPhone) params.phoneNumber = callAsPhone;
      const connection = await deviceRef.current.connect({ params });
      connectionRef.current = connection;

      connection.on('accept', () => {
        const sid = connection.parameters?.CallSid ?? '';
        setCallSid(sid);
        setStatus('live');
        setStatusDetail('Connected to the voice agent.');
        startTimeRef.current = Date.now();
        setCallDuration(0);
        if (tickTimerRef.current) clearInterval(tickTimerRef.current);
        tickTimerRef.current = setInterval(() => {
          setCallDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
        if (sid) socketRef.current?.emit('join_call', sid);
      });

      connection.on('disconnect', () => {
        setStatus('ended');
        setStatusDetail('Call ended.');
        if (tickTimerRef.current) clearInterval(tickTimerRef.current);
        startPollingRecording(connection.parameters?.CallSid ?? callSid);
      });

      connection.on('error', (err: any) => {
        console.error('[connection error]', err);
        setStatus('error');
        setStatusDetail(err?.message ?? String(err));
      });
    } catch (err) {
      console.error(err);
      setStatus('error');
      setStatusDetail(err instanceof Error ? err.message : String(err));
    }
  }, [callSid, callAsPhone]);

  const hangUp = useCallback(() => {
    setStatus('disconnecting');
    try {
      connectionRef.current?.disconnect();
    } catch (err) {
      console.warn('[hangUp] failed:', err);
    }
  }, []);

  // ---- Recording / Intelligence polling ------------------------------------
  const startPollingRecording = useCallback((sid: string) => {
    if (!sid) return;
    setPollingRecording(true);
    setRecording({ status: 'in_progress', message: 'Waiting for Intelligence transcript…' });
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    let attempts = 0;
    pollTimerRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const res = await fetch(`/api/get-recording-pii?callSid=${encodeURIComponent(sid)}`);
        const data = (await res.json()) as RecordingSummary;
        if (data.status === 'completed') {
          setRecording(data);
          setPollingRecording(false);
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        } else {
          setRecording((prev) => ({ ...(prev ?? {}), ...data }));
        }
      } catch (err) {
        console.warn('[poll] failed:', err);
      }
      if (attempts > 60) {
        // ~10 minutes; give up automatically
        setPollingRecording(false);
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      }
    }, 10000);
  }, []);

  const runAnalysis = useCallback(
    async (rec: RecordingSummary) => {
      const key = rec.transcriptSid ?? callSid;
      if (!key) return;
      if (analysisRequestedForRef.current === key) return;
      analysisRequestedForRef.current = key;
      setAnalysisLoading(true);
      setAnalysisError(null);
      try {
        const res = await fetch('/api/call-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullTranscript: rec.fullTranscript ?? '',
            piiEntities: rec.piiEntities ?? [],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `analysis endpoint returned ${res.status}`);
        setAnalysis(data as CallAnalysis);
      } catch (err) {
        analysisRequestedForRef.current = null;
        setAnalysisError(err instanceof Error ? err.message : String(err));
      } finally {
        setAnalysisLoading(false);
      }
    },
    [callSid],
  );

  useEffect(() => {
    if (recording?.status === 'completed' && recording.fullTranscript) {
      runAnalysis(recording);
    }
  }, [recording, runAnalysis]);

  const checkRecordingNow = useCallback(async () => {
    if (!callSid) return;
    setRecordingError(null);
    try {
      const res = await fetch(`/api/get-recording-pii?callSid=${encodeURIComponent(callSid)}`);
      const data = (await res.json()) as RecordingSummary;
      setRecording(data);
    } catch (err) {
      setRecordingError(err instanceof Error ? err.message : String(err));
    }
  }, [callSid]);

  const formattedDuration = `${String(Math.floor(callDuration / 60)).padStart(2, '0')}:${String(
    callDuration % 60,
  ).padStart(2, '0')}`;

  const inCall = status === 'live' || status === 'connecting' || status === 'disconnecting';

  return (
    <Layout
      title="Call Agent"
      subtitle="Dial the Bay Area Learning Center voice agent from your browser. The agent runs inline in this app (GPT-4o driving the Airtable + sendRCS tools). Pick which enrollment to call as, watch the live transcript stream in, then review the post-call Twilio Intelligence transcript with PII redaction."
    >
      <div className={styles.grid}>
        <section className={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                Voice agent
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>
                Bay Area Learning Center
              </div>
              <div className={styles.helper} style={{ marginTop: 2 }}>
                Inline agent · GPT-4o · Airtable + RCS tools
              </div>
              <div className={styles.helper} style={{ marginTop: 8 }}>
                Status: <strong>{statusLabel(status)}</strong>{inCall && ` · ${formattedDuration}`}
              </div>
              <div className={styles.helper}>{statusDetail}</div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className={styles.field} style={{ minWidth: 240 }}>
                <label className={styles.label}>Call as</label>
                <select
                  className={styles.select}
                  value={callAsPhone}
                  onChange={(e) => setCallAsPhone(e.target.value)}
                  disabled={inCall}
                >
                  {appointments.length === 0 && <option value="">(no appointments loaded)</option>}
                  {appointments.map((a) => (
                    <option key={a.id} value={a.phoneNumber}>
                      {a.customerName} · {a.phoneNumber}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={beginCall}
                disabled={status !== 'ready' && status !== 'ended' && status !== 'error'}
              >
                Call agent
              </button>
              <button
                className={`${styles.button} ${styles.buttonDanger}`}
                onClick={hangUp}
                disabled={!inCall}
              >
                Hang up
              </button>
            </div>
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardHeading}>Live transcript</h2>
          <p className={styles.helper}>
            Streamed via Twilio real-time transcription over Socket.IO. Speaker labels come from the RTP track direction.
          </p>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 180,
              maxHeight: 380,
              overflowY: 'auto',
              background: '#f8fafc',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 16,
            }}
          >
            {transcript.length === 0 && (
              <div className={styles.helper}>Nothing yet — start a call to see live speech.</div>
            )}
            {transcript.map((line, i) => (
              <div
                key={`${line.timestamp}-${i}`}
                style={{
                  alignSelf: line.speaker === 'AGENT' ? 'flex-start' : 'flex-end',
                  maxWidth: '80%',
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: line.speaker === 'AGENT' ? '#eff6ff' : '#ecfdf5',
                  border: `1px solid ${line.speaker === 'AGENT' ? '#bfdbfe' : '#a7f3d0'}`,
                  fontSize: 14,
                  color: '#0f172a',
                  opacity: line.isFinal ? 1 : 0.72,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    color: line.speaker === 'AGENT' ? '#1d4ed8' : '#047857',
                    marginBottom: 4,
                    textTransform: 'uppercase',
                  }}
                >
                  {line.speaker}{!line.isFinal && ' (partial)'}
                </div>
                <div>{line.text}</div>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <h2 className={styles.cardHeading}>Post-call Intelligence</h2>
              <p className={styles.helper} style={{ maxWidth: 620 }}>
                After the call ends, Twilio Conversational Intelligence transcribes the recording and produces a redacted audio + text version. Transcript creation usually takes 30–90 seconds; polling starts automatically.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={checkRecordingNow}
                disabled={!callSid}
              >
                {pollingRecording ? 'Polling…' : 'Check now'}
              </button>
            </div>
          </div>

          {recordingError && <div className={styles.error}>{recordingError}</div>}

          {recording && (
            <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
              {recording.status !== 'completed' && (
                <div className={`${styles.banner} ${styles.bannerWarn}`}>
                  <span className={styles.bannerDot} /> Status: <strong>{recording.status}</strong>
                  {recording.message && ` — ${recording.message}`}
                </div>
              )}

              {recording.status === 'completed' && (
                <>
                  <div className={`${styles.banner} ${styles.bannerOk}`}>
                    <span className={styles.bannerDot} /> Transcript ready · {recording.piiCount ?? 0} PII item(s) detected
                  </div>

                  <div className={`${styles.grid} ${styles.gridCols2}`}>
                    <div>
                      <div className={styles.helper}>Original recording</div>
                      {recording.recordingUrl ? (
                        <audio controls src={recording.recordingUrl} style={{ width: '100%' }} />
                      ) : (
                        <div className={styles.helper}>Not available.</div>
                      )}
                    </div>
                    <div>
                      <div className={styles.helper}>Redacted audio (PII → beep)</div>
                      {recording.redactedMediaUrl ? (
                        <audio controls src={recording.redactedMediaUrl} style={{ width: '100%' }} />
                      ) : (
                        <div className={styles.helper}>Not available.</div>
                      )}
                    </div>
                  </div>

                  {recording.fullTranscript && (
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        Show full transcript
                      </summary>
                      <pre className={styles.pre}>{recording.fullTranscript}</pre>
                    </details>
                  )}

                  {recording.piiEntities && recording.piiEntities.length > 0 && (
                    <div>
                      <div className={styles.helper}>Detected entities</div>
                      <div className={styles.tableWrap} style={{ marginTop: 6 }}>
                        <table className={styles.table}>
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Value</th>
                              <th>Confidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recording.piiEntities.map((ent, i) => (
                              <tr key={`${ent.type}-${i}`}>
                                <td>
                                  <code className={styles.inlineCode}>{ent.type}</code>
                                </td>
                                <td>{ent.value}</td>
                                <td>{ent.confidence}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {(recording?.status === 'completed' || analysis || analysisLoading || analysisError) && (
          <section className={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h2 className={styles.cardHeading}>Post-call analysis</h2>
                <p className={styles.helper} style={{ maxWidth: 620 }}>
                  Sentiment and PII summary derived from the completed Intelligence transcript (sentiment via GPT-4o-mini; PII categories from Twilio's redaction operators).
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  className={`${styles.button} ${styles.buttonSecondary}`}
                  onClick={() => {
                    if (recording?.status === 'completed') {
                      analysisRequestedForRef.current = null;
                      runAnalysis(recording);
                    }
                  }}
                  disabled={analysisLoading || recording?.status !== 'completed'}
                >
                  {analysisLoading ? 'Analyzing…' : 'Re-run analysis'}
                </button>
              </div>
            </div>

            {analysisError && <div className={styles.error}>{analysisError}</div>}

            {analysisLoading && !analysis && (
              <div className={styles.helper} style={{ marginTop: 12 }}>
                Running sentiment + PII analysis on the transcript…
              </div>
            )}

            {analysis && (
              <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
                <div className={`${styles.grid} ${styles.gridCols2}`}>
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 12,
                      border: `1px solid ${sentimentBorder(analysis.sentiment.label)}`,
                      background: sentimentBg(analysis.sentiment.label),
                    }}
                  >
                    <div className={styles.helper}>Caller sentiment</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4, textTransform: 'capitalize' }}>
                      {analysis.sentiment.label} · {analysis.sentiment.score.toFixed(2)}
                    </div>
                    <div style={{ fontSize: 13, color: '#334155', marginTop: 6 }}>
                      {analysis.sentiment.rationale}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 14,
                      borderRadius: 12,
                      border: `1px solid ${analysis.pii.found ? '#fcd34d' : '#a7f3d0'}`,
                      background: analysis.pii.found ? '#fffbeb' : '#ecfdf5',
                    }}
                  >
                    <div className={styles.helper}>PII discussed</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>
                      {analysis.pii.found ? `${analysis.pii.count} item(s)` : 'None detected'}
                    </div>
                    <div style={{ fontSize: 13, color: '#334155', marginTop: 6 }}>
                      {analysis.pii.summary}
                    </div>
                    {analysis.pii.types.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        {analysis.pii.types.map((t) => (
                          <code key={t} className={styles.inlineCode}>{t}</code>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </Layout>
  );
}

function sentimentBorder(label: CallAnalysis['sentiment']['label']): string {
  switch (label) {
    case 'positive':
      return '#a7f3d0';
    case 'negative':
      return '#fecaca';
    case 'mixed':
      return '#fcd34d';
    default:
      return '#e5e7eb';
  }
}

function sentimentBg(label: CallAnalysis['sentiment']['label']): string {
  switch (label) {
    case 'positive':
      return '#ecfdf5';
    case 'negative':
      return '#fef2f2';
    case 'mixed':
      return '#fffbeb';
    default:
      return '#f8fafc';
  }
}
