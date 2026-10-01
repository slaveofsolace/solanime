import { useEffect, useState } from 'react';
import { BrandReadiness } from './BrandReadiness';
import { SolanimeBrand } from './SolanimeBrand';
import { INTRO_MS, LOOP_MS, type BrandMotion } from './timeline';
import type { BrandVariant } from './BrandArtwork';
import './demo.css';

const states: BrandMotion[] = ['intro', 'loading', 'static', 'ready', 'error'];

export function BrandDemo() {
  const params = new URLSearchParams(location.search);
  const initial = params.get('state');
  const [motion, setMotion] = useState<BrandMotion>(states.includes(initial as BrandMotion) ? initial as BrandMotion : 'intro');
  const [variant, setVariant] = useState<BrandVariant>(params.get('variant') === 'compact' ? 'compact' : params.get('variant') === 'emblem' ? 'emblem' : 'full');
  const [theme, setTheme] = useState<'dark' | 'light'>(params.get('theme') === 'light' ? 'light' : 'dark');
  const [reduced, setReduced] = useState(params.get('reduced') === '1');
  const [instance, setInstance] = useState(0);
  const [sample, setSample] = useState<number | undefined>(params.has('time') ? Number(params.get('time')) : undefined);
  const [dismissed, setDismissed] = useState(false);
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error' | null>(null);
  const [keepSession, setKeepSession] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [exitCount, setExitCount] = useState(0);
  const exportMode = params.get('export') === '1';
  useEffect(() => {
    if (!exportMode) return;
    const sampleFrame = (event: Event) => {
      const detail = (event as CustomEvent<{ time?: unknown }>).detail;
      if (!detail || typeof detail.time !== 'number' || !Number.isFinite(detail.time) || detail.time < 0 || detail.time > 60000) return;
      setSample(detail.time);
    };
    document.addEventListener('solanime-brand-sample', sampleFrame);
    return () => document.removeEventListener('solanime-brand-sample', sampleFrame);
  }, [exportMode]);
  const select = (state: BrandMotion) => { setSample(undefined); setDismissed(false); setMotion(state); if (state !== 'ready') setInstance(value => value + 1); };
  return <main className={`sol-brand-demo ${exportMode ? 'sol-brand-demo--export' : ''}`} data-theme={theme} data-export={exportMode} data-canvas={params.get('opaque') === '1' ? 'dark' : 'transparent'}>
    {!exportMode && <header className="sol-brand-demo__header"><a href="/branding.html" aria-label="Brand studio home">Solanime / Brand studio</a><span>Motion system</span></header>}
    <section className="sol-brand-demo__stage" aria-label="Brand animation preview">
      {mounted && <SolanimeBrand key={instance} variant={variant} theme={theme} motion={motion} reducedMotion={reduced}
        sessionKey={keepSession ? 'brand-demo-persistent' : undefined} elapsedMs={sample}
        onExitComplete={() => { setDismissed(true); setExitCount(value => value + 1); }} />}
    </section>
    {!exportMode && <>
      <section className="sol-brand-demo__controls" aria-label="Animation controls">
        <div className="sol-brand-demo__modes">{states.map(state => <button key={state} onClick={() => select(state)} aria-pressed={motion === state}>{state === 'ready' ? 'Exit now' : state[0].toUpperCase() + state.slice(1)}</button>)}</div>
        <div className="sol-brand-demo__options">
          <label>Placement<select value={variant} onChange={event => setVariant(event.target.value as BrandVariant)}><option value="full">Full identity</option><option value="compact">Navigation</option><option value="emblem">Emblem only</option></select></label>
          <label>Theme<select value={theme} onChange={event => setTheme(event.target.value as 'dark' | 'light')}><option value="dark">Dark</option><option value="light">Light</option></select></label>
          <label className="sol-brand-demo__toggle"><input type="checkbox" checked={reduced} onChange={event => setReduced(event.target.checked)} /> Saved reduced motion</label>
          <label className="sol-brand-demo__toggle"><input type="checkbox" checked={keepSession} onChange={event => setKeepSession(event.target.checked)} /> Preserve boot session</label>
        </div>
        <label className="sol-brand-demo__scrubber">Timeline sample <output>{sample === undefined ? 'Playing at normal speed' : `${sample} ms`}</output>
          <input aria-label="Timeline sample" type="range" min="0" max={motion === 'loading' ? LOOP_MS : INTRO_MS} step="10" value={sample ?? 0} onChange={event => setSample(Number(event.target.value))} />
        </label>
        <div className="sol-brand-demo__modes"><button onClick={() => { setSample(undefined); setInstance(value => value + 1); setDismissed(false); }}>Replay at normal speed</button><button onClick={() => setMounted(value => !value)}>{mounted ? 'Unmount mark' : 'Remount mark'}</button><button onClick={() => setBoot('loading')}>Test application readiness</button></div>
        <p role="status" data-demo-status>{dismissed ? 'Exit complete' : motion === 'error' ? 'Static error identity — no loading loop' : sample === undefined ? 'Live timeline' : 'Frame sample'} · exit callbacks: {exitCount}</p>
      </section>
      <section className="sol-brand-demo__variants" aria-label="Static placement previews">
        <div><span>Navigation — 180px wide</span><SolanimeBrand variant="compact" motion="static" theme={theme} style={{ width: 180 }} /></div>
        <div><span>Emblem — 40px</span><SolanimeBrand variant="emblem" motion="static" theme={theme} style={{ width: 40 }} /></div>
        <div><span>Loading — 40px</span><SolanimeBrand variant="emblem" motion="loading" theme={theme} reducedMotion={reduced} style={{ width: 40 }} /></div>
      </section>
      <footer className="sol-brand-demo__footer">Preview of the logo animation used when Solanime opens.</footer>
    </>}
    {boot && <><BrandReadiness ready={boot === 'ready'} error={boot === 'error' ? 'The catalogue could not be loaded.' : null} onRetry={() => setBoot('loading')} onDismiss={() => setBoot(null)} reducedMotion={reduced} theme={theme} sessionKey={`demo-boot-${instance}`} />
      <div className="sol-brand-demo__readiness-tools"><button onClick={() => setBoot('ready')}>Application ready</button><button onClick={() => setBoot('error')}>Simulate loading failure</button></div>
    </>}
  </main>;
}
