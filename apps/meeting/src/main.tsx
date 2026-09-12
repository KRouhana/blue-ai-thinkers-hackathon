import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { captureAdapter } from 'fork-perception';
import { createHttpClient } from './integration/client';
import { createFixtureClient, getFixturePreviewConfig } from './integration/fixture';
import { emptyState, reduceEvent, type WorkspaceState } from './integration/state';
import { decodePreview, previewUrl } from './integration/bridge';
import type { ConnectionState, SessionControl } from './integration/types';
import './style.css';

const fixture = import.meta.env.FORK_MODE === 'fixture';
const fixtureClient = fixture ? createFixtureClient() : null;
const client = fixtureClient || createHttpClient('/api', import.meta.env.FORK_PROJECT_CONFIG_ID, import.meta.env.FORK_PROJECT_MODE);
const allowedPreviewOrigin = import.meta.env.FORK_PREVIEW_ORIGIN;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'The operation could not be completed.';
const activeStates = new Set(['queued', 'running', 'checking']);

function App() {
  const [state, setState] = useState<WorkspaceState>(emptyState);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [consent, setConsent] = useState(false);
  const [render, setRender] = useState<'waiting'|'rendered'|'error'>('waiting');
  const [frameError, setFrameError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [captureActive, setCaptureActive] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const captureStarted = useRef(false);
  const captureGeneration = useRef(0);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const snapshot = state.snapshot;
  const safeUrl = previewUrl(snapshot?.previewUrl || null, allowedPreviewOrigin);
  const latest = snapshot?.experiments.filter(e => e.status === 'visible').at(-1);
  const activeJob = state.job && activeStates.has(state.job.state) ? state.job : null;
  const stopped = snapshot?.capture === 'stopped';
  const paused = snapshot?.capture === 'paused';
  const online = connection === 'connected';

  useEffect(() => {
    if (!notice) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) setNotice(false);
      if (event.key !== 'Tab') return;
      const controls = [...document.querySelectorAll<HTMLElement>('.notice-dialog button:not(:disabled), .notice-dialog input')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [notice]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false, unsubscribe: (() => void) | undefined;
    setConnection('connecting');
    const id = new URLSearchParams(location.search).get('session');
    void (id && !fixture ? client.snapshot(id) : client.create()).then(value => {
      if (cancelled) return;
      setState({ ...emptyState, snapshot: value });
      const url = new URL(location.href);
      url.searchParams.set('session', value.id);
      history.replaceState(null, '', url);
      unsubscribe = client.subscribe(value.id, value.lastEventSequence,
        event => { if (!cancelled) setState(previous => reduceEvent(previous, event)); },
        value => { if (!cancelled) setConnection(value); });
    }).catch(error => { if (!cancelled) { setState(previous => ({ ...previous, error: errorText(error) })); setConnection('offline'); } });
    return () => { cancelled = true; mounted.current = false; captureGeneration.current++; unsubscribe?.(); if (captureStarted.current) { void captureAdapter.stop().catch(() => {}); captureStarted.current = false; } };
  }, [reload]);

  // Remote pause/stop must close or pause the local adapter too. A never starts
  // collecting merely because Slack or a replayed event says "listening".
  useEffect(() => {
    if (fixture || !snapshot || snapshot.capture === 'listening') return;
    captureGeneration.current++;
    if (captureStarted.current) {
      captureStarted.current = false;
      setCaptureActive(false);
      void captureAdapter.stop().catch(error => setState(s => ({ ...s, error: errorText(error) })));
    }
  }, [snapshot?.capture]);

  function sendFixtureConfig() {
    if (fixture && snapshot && frame.current?.contentWindow) {
      frame.current.contentWindow.postMessage(getFixturePreviewConfig(snapshot), allowedPreviewOrigin);
    }
  }
  useEffect(() => { setRender('waiting'); setFrameError(null); sendFixtureConfig(); }, [snapshot?.revision.source, snapshot?.revision.config, safeUrl]);
  useEffect(() => {
    if (!snapshot) return;
    const listener = (event: MessageEvent) => {
      const data = decodePreview(event, frame.current?.contentWindow || null, allowedPreviewOrigin, snapshot.workspaceId, snapshot.revision);
      if (!data) return;
      if (data.type === 'fork.preview.rendered') { setRender('rendered'); setFrameError(null); }
      if (data.type === 'fork.preview.error') { setRender('error'); setFrameError(data.message); }
      if (data.type === 'fork.preview.context' && snapshot.capture === 'listening' && !fixture) {
        const { type: _, ...context } = data;
        void client.observe(snapshot.id, [{ ...context, kind: 'preview_context', id: crypto.randomUUID(), sessionId: snapshot.id, captureEpoch: snapshot.captureEpoch, capturedAt: new Date().toISOString(), version: 1 }])
          .catch(error => setState(s => ({ ...s, error: errorText(error) })));
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [snapshot]);

  async function perform(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label); setState(s => ({ ...s, error: null }));
    try {
      await action();
      if (snapshot) {
        const value = await client.snapshot(snapshot.id);
        if (mounted.current) setState(s => !s.snapshot || (s.snapshot.id === value.id && value.lastEventSequence >= s.snapshot.lastEventSequence) ? { ...s, snapshot: value } : s);
      }
    } catch (error) { if (mounted.current) setState(s => ({ ...s, error: errorText(error) })); }
    finally { busyRef.current = false; if (mounted.current) setBusy(null); }
  }
  async function connectCapture(id: string) {
    const current = await client.snapshot(id);
    if (current.capture !== 'listening') throw new Error('Waiting for B to confirm that capture is listening.');
    const generation = ++captureGeneration.current;
    try {
      await captureAdapter.start({ sessionId: current.id, captureEpoch: current.captureEpoch, sink: async observations => {
        if (!mounted.current || captureGeneration.current !== generation) return;
        await client.observe(current.id, observations);
        if (mounted.current) setCaptions(previous => [...previous, ...observations.filter(o => o.kind === 'transcript' && o.phase === 'final').map(o => o.kind === 'transcript' ? o.text : '')].slice(-20));
      } });
      if (!mounted.current || captureGeneration.current !== generation) { await captureAdapter.stop(); return; }
      captureStarted.current = true; setCaptureActive(true);
    } catch (error) {
      captureGeneration.current++;
      await Promise.allSettled([captureAdapter.stop(), client.capture(id, 'stop')]);
      throw error;
    }
  }
  function control(value: SessionControl) {
    if (!snapshot) return;
    void perform(value.kind === 'cancel_job' ? 'Cancelling…' : 'Updating…', async () => {
      if (!fixture && (value.kind === 'pause' || value.kind === 'stop')) {
        captureGeneration.current++;
        captureStarted.current = false; setCaptureActive(false);
        const results = await Promise.allSettled([captureAdapter.stop(), client.control(snapshot.id, value)]);
        const failure = results.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        return;
      }
      await client.control(snapshot.id, value);
      if (!fixture && value.kind === 'resume') await connectCapture(snapshot.id);
    });
  }
  async function start() {
    if (!snapshot || !consent) return;
    await perform('Starting…', async () => {
      if (!fixture && !captureAdapter.available) throw new Error('Connect A’s capture adapter before starting live capture. Huddle participation is not connected.');
      await client.capture(snapshot.id, 'start');
      if (!fixture) await connectCapture(snapshot.id);
      setNotice(false);
    });
  }

  return <div className="app">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Fork workspace"><span className="brand-mark">⑂</span>fork<span className="brand-dot">.</span></a>
      <span className="top-divider" /> <span className="workspace-name">The brainstorm room</span>
      <div className="top-right"><span className={`mode-tag ${fixture ? '' : 'live'}`}>{fixture ? 'FIXTURE WORKSPACE' : 'LIVE API MODE'}</span><span className="avatar" title="Local host">You</span></div>
    </header>

    <main>
      <section className="heading"><div><div className="eyebrow">IDEAS, TAKING SHAPE</div><h1>Make room for what’s next.</h1><p>Talk it through. Try it out. Keep what works.</p></div><div className="session-indicator"><span className={`dot ${snapshot?.capture === 'listening' ? 'green' : ''}`} />{!snapshot ? 'Connecting workspace' : stopped ? 'Ready to begin' : paused ? 'Session paused' : fixture ? 'Fixture session active' : 'Session active'}</div></section>

      <div className="workspace-grid">
        <section className="preview-panel" aria-label="Live prototype">
          <div className="panel-toolbar"><div className="tab active"><span className="tiny-window" />Prototype</div><span className="mock-badge">{fixture ? 'Mock data · fixture' : 'Demo workspace'}</span><span className="revision">{snapshot ? `v${snapshot.revision.source}.${snapshot.revision.config}` : '—'}</span></div>
          <div className="address-row"><span className="lock-icon">◇</span><span>{safeUrl ? new URL(safeUrl).host + new URL(safeUrl).pathname : 'Waiting for a preview'}</span><span className="preview-status">{render === 'rendered' ? '● Rendered locally' : render === 'error' ? 'Preview error' : '○ Waiting for render'}</span></div>
          <div className="preview-body">
            {safeUrl ? <iframe ref={frame} title="Fork prototype preview" src={safeUrl} sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" onLoad={sendFixtureConfig} /> : <div className="empty-preview"><span className="empty-symbol">⑂</span><h2>Your next idea starts here.</h2><p>{snapshot?.previewUrl ? 'The preview URL does not match the configured preview origin.' : 'The prototype will appear when C’s workspace is ready.'}</p></div>}
            {frameError && <div className="preview-error" role="alert">{frameError} <span>The last preview stays in place.</span></div>}
          </div>
          <footer className="preview-footer"><span><span className="dot" />{fixture ? 'Prepared fixture, not generated code' : 'Reversible experiments'} </span><span>Local preview · not shared in Huddle</span></footer>
        </section>

        <aside className="activity-panel" aria-label="Session activity">
          <div className="activity-heading"><span className="fork-spark">✳</span><div><h2>Along for the idea.</h2><span>Fork workspace</span></div><span className="activity-dots">···</span></div>
          <div className="connection-card"><div><span className={`dot ${online ? 'green' : ''}`} /><strong>{fixture ? 'Fixture events' : 'Session service'}</strong><span className="connection-state">{connection}</span></div><p>{fixture ? 'Explore the workspace with staged events. No meeting audio or AI calls.' : captureAdapter.source}</p></div>
          <div className="huddle-status"><span>SLACK HUDDLE</span><strong>Participant transport not connected</strong><p>Joining, speaker identity, and automatic screen sharing still need a verified integration.</p></div>

          <div className="activity-feed" aria-live="polite">
            <div className="feed-label">IN THIS SESSION <span>{snapshot?.experiments.length || 0}</span></div>
            {snapshot?.currentTopic && <p className="topic">{snapshot.currentTopic}</p>}
            {!snapshot?.experiments.length && <div className="quiet-state"><span>⌁</span><h3>A little space to think.</h3><p>Experiments and decisions will appear here as the idea develops.</p></div>}
            {snapshot?.experiments.slice(-8).reverse().map(experiment => <article className={`experiment ${experiment.status}`} key={experiment.id}><span className="experiment-icon">{experiment.status === 'visible' ? '✓' : experiment.status === 'reverted' ? '↶' : '·'}</span><div><h3>{experiment.summary}</h3><span className="experiment-meta">{experiment.status} · v{experiment.revision.source}.{experiment.revision.config}</span>{experiment.mockNotes.map(note => <p className="mock-note" key={note}>{note}</p>)}{latest?.id === experiment.id && <button className="text-button" disabled={!!busy || !online} onClick={() => control({ kind: 'undo', experimentId: experiment.id })}>Undo experiment ↶</button>}</div></article>)}
            {state.job && <div className="job-card"><span className={activeJob ? 'spinner' : ''}>{activeJob ? '' : state.job.state === 'ready' ? '✓' : '·'}</span><div><strong>{state.job.message}</strong><small>{state.job.state}{fixture ? ' · simulated worker' : ''}</small></div>{activeJob && <button onClick={() => control({ kind: 'cancel_job', jobId: activeJob.jobId })} disabled={!!busy || !online}>Cancel</button>}</div>}
            {!fixture && !state.jobKnown && <p className="small-note">Active job information is unavailable in the v2 reconnect snapshot.</p>}
            {snapshot?.clarification && <div className="clarification"><span>A QUICK CLARIFICATION</span><h3>{snapshot.clarification.question}</h3>{snapshot.clarification.candidates.map(candidate => <button key={candidate.id} disabled={!!busy || !online} onClick={() => control({ kind: 'clarification_answer', intentId: snapshot.clarification!.intentId, candidateId: candidate.id })}>{candidate.label} <span>↗</span></button>)}</div>}
          </div>
          <div className="bottom-note"><span className="dot green" />{busy || state.message}</div>
        </aside>
      </div>

      {state.error && <div role="alert" className="error-banner"><strong>Something needs attention.</strong><span>{state.error}</span>{connection === 'offline' && <button onClick={() => setReload(v => v + 1)}>Reconnect</button>}<button aria-label="Dismiss error" onClick={() => setState(s => ({ ...s, error: null }))}>×</button></div>}

      <section className="control-bar" aria-label="Session controls"><div className="capture-info"><span className="mic-icon">◉</span><div><strong>{fixture ? 'No audio captured' : captureAdapter.source}</strong><span>{fixture ? 'Fixture mode · local only' : 'Capture starts with host permission'}</span></div></div><div className="controls">
        {stopped || (!fixture && !paused && !captureActive) ? <button className="primary" disabled={!!busy || !snapshot || !online} onClick={() => { setConsent(false); setNotice(true); }}>{fixture ? 'Start fixture session' : stopped ? 'Start session' : 'Connect audio'} <span>↗</span></button> : <button disabled={!!busy || !online || (!fixture && paused && !captureAdapter.available)} onClick={() => control({ kind: paused ? 'resume' : 'pause' })}>{paused ? '▶ Resume' : 'Ⅱ Pause'}</button>}
        <button disabled={!!busy || !latest || !online} onClick={() => latest && control({ kind: 'undo', experimentId: latest.id })}>↶ Undo</button>
        <button className="stop" disabled={!!busy || !snapshot || stopped} onClick={() => control({ kind: 'stop' })}>■ Stop</button>
      </div></section>
      {fixtureClient && <div className="fixture-tools"><span>DEVELOPMENT FIXTURE</span><p>Step through a visual edit, correction, build, clarification, and recovery.</p><button disabled={!snapshot || stopped || paused || !!busy} onClick={() => fixtureClient.advanceScenario()}>Next fixture event →</button></div>}
      <details className="captions"><summary>Transcript <span>Optional captions</span></summary><div>{captions.length ? captions.map((text, i) => <p key={i}>{text}</p>) : <p>{fixture ? 'No transcript is being captured in fixture mode.' : 'Final captions appear when A’s local capture adapter emits them. The v2 session event contract does not replay transcripts.'}</p>}</div></details>
      <div className="page-foot"><span>Made for the messy, good part of making things.</span><span>FORK / MEETING WORKSPACE</span></div>
    </main>

    {notice && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="notice-title" className="notice-dialog"><span className="fork-spark">✳</span><h2 id="notice-title">A little room to experiment.</h2><p>Fork can make reversible changes to this demo workspace. It will not change the original repository or deploy anything.</p><p>{fixture ? 'This session uses fixture events. It does not capture audio, join a Huddle, or call an AI model.' : 'Inform everyone before starting. Audio and context may be sent to remote model services; this is not on-device inference. Huddle participation is currently unavailable.'}</p><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} autoFocus />{fixture ? 'Enable reversible fixture experiments.' : 'Participants have been informed. Enable capture and reversible demo experiments.'}</label><div className="dialog-actions"><button onClick={() => setNotice(false)}>Not yet</button><button className="primary" disabled={!consent || !!busy} onClick={() => void start()}>{busy || 'Begin session →'}</button></div>{state.error && <p role="alert" className="dialog-error">{state.error}</p>}</section></div>}
  </div>;
}
function Presenter() {
  const [state, setState] = useState<WorkspaceState>(emptyState);
  useEffect(() => {
    let cancelled = false, unsubscribe: (() => void) | undefined;
    const id = new URLSearchParams(location.search).get('session');
    void (id && !fixture ? client.snapshot(id) : client.create()).then(value => {
      if (cancelled) return;
      setState({ ...emptyState, snapshot: value });
      unsubscribe = client.subscribe(value.id, value.lastEventSequence,
        event => { if (!cancelled) setState(previous => reduceEvent(previous, event)); }, () => {});
    }).catch(() => {});
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  const safeUrl = previewUrl(state.snapshot?.previewUrl || null, allowedPreviewOrigin);
  return <div className="presenter-view">
    {safeUrl
      ? <iframe title="Fork prototype presenter" src={safeUrl} sandbox="allow-scripts allow-same-origin" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" referrerPolicy="no-referrer" />
      : <div className="presenter-empty"><span className="fork-spark">⑂</span><p>Waiting for a preview…</p></div>}
  </div>;
}

const presenter = new URLSearchParams(location.search).get('presenter') === '1';
createRoot(document.getElementById('root')!).render(presenter ? <Presenter /> : <App />);
