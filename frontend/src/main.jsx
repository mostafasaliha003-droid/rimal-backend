import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { LanguageProvider } from './i18n';
import MembershipBoundary from './components/MembershipBoundary';
import PillowWait from './components/PillowWait';
import './pillow-stays.css';

// The member experience (search, hotels, checkout) loads only once membership allows it; visitors get the public front alone.
const App = lazy(() => import('./App'));

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    });
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <LanguageProvider>
            <Suspense fallback={<main className="pillow-wait-page"><PillowWait /></main>}><MembershipBoundary><App /></MembershipBoundary></Suspense>
        </LanguageProvider>
    </StrictMode>
);
