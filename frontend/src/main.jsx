import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { LanguageProvider } from './i18n';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    });
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <LanguageProvider>
            <Suspense fallback={<main role="status" className="p-10 text-center">جار تحميل الصفحة...</main>}><App /></Suspense>
        </LanguageProvider>
    </StrictMode>
);
