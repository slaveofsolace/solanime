import { createContext, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppState } from '../state';
import { useAccount } from '../account/AccountProvider';
import { BrandReadiness } from './BrandReadiness';
import { isBrandSessionResolved } from './timeline';

type Readiness = { path: string; ready: boolean; error?: string | null; retry?: () => void };
const Context = createContext<((state: Readiness) => void) | null>(null);
const BOOT = 'solanime-application-boot';

export function useInitialReadiness(ready: boolean, error?: string | null, retry?: () => void) {
  const report = useContext(Context);
  const location = useLocation();
  const retryRef = useRef(retry);
  retryRef.current = retry;
  useEffect(() => { report?.({ path: location.pathname, ready, error, retry: retry ? () => retryRef.current?.() : undefined }); },
    [report, ready, error, location.pathname, Boolean(retry)]);
}

export default function ApplicationReadiness({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  const auth = useAccount();
  const { preferences: [prefs] } = useAppState();
  const [dismissed, setDismissed] = useState(() => isBrandSessionResolved(BOOT));
  const [state, setState] = useState<Readiness>({ path: '', ready: false });
  const dataRoute = pathname === '/' || pathname === '/catalogue' || pathname === '/search' || /^\/(title|watch)\//.test(pathname);
  // The private-site gate can render before a data page mounts. An account
  // restoration failure must be surfaced immediately instead of appearing as
  // an endless catalogue load (or waiting for the generic timeout).
  const ready = dataRoute
    ? auth.ready && (auth.privateSite && !auth.account || state.path === pathname && state.ready)
    : auth.ready;
  const error = auth.loadError ?? (dataRoute && state.path === pathname ? state.error : null);
  return <Context.Provider value={setState}>
    {!dismissed && <BrandReadiness ready={ready} error={error} sessionKey={BOOT}
      onDismiss={() => setDismissed(true)} onRetry={dataRoute ? state.retry : () => void auth.refresh()}
      theme={prefs.theme} reducedMotion={prefs.motion === 'reduced'} />}
    <div className="application-content" inert={!dismissed}>{children}</div>
  </Context.Provider>;
}
