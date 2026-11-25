import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { LanguageProvider } from './i18n';
import MembershipBoundary from './components/MembershipBoundary';
import PillowWait from './components/PillowWait';
import './pillow-stays.css';

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
