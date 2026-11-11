import { Suspense, lazy, useEffect, useState } from 'react';
import { Footer, Header } from './components/SiteShell';
import { Skeleton } from './components/ui';
import { Home } from './pages/Home';

const ConsolePage = lazy(() => import('./pages/Console'));
const TestsPage = lazy(() => import('./pages/Tests'));
const PreferencesPage = lazy(() => import('./pages/Preferences'));

export default function App() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const update = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  const page = hash.startsWith('#/console') ? <ConsolePage /> : hash.startsWith('#/tests') ? <TestsPage /> : hash.startsWith('#/preferences') ? <PreferencesPage /> : <Home />;
  return <><Header /><main><Suspense fallback={<div className="container page-loading"><Skeleton width="40%" height={48} label="Loading page" /><Skeleton width="100%" height={240} label="Loading page" /></div>}>{page}</Suspense></main><Footer /></>;
}
