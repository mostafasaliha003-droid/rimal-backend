import { useMemo } from 'react';
import { FieldError } from './SearchFeedback';
import { SUPPORTED_RESIDENCY_CODES } from './searchModel';

export function residencyLabel(code, language = 'en') {
    if (!code) return '';
    try {
        const displayLanguage = ['ar', 'en', 'es'].includes(language) ? language : 'en';
        const label = new Intl.DisplayNames([displayLanguage], { type: 'region' }).of(code.toUpperCase());
        return label && label !== code.toUpperCase() ? label : code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

export default function ResidencySelector({ controller }) {
    const { t, language, residency, changeResidency, errors } = controller;
    const options = useMemo(() => SUPPORTED_RESIDENCY_CODES
        .map(code => ({ code, label: residencyLabel(code, language) }))
        .sort((first, second) => first.label.localeCompare(second.label, language)), [language]);

    return <div className="min-w-0">
        <div className={`search-field ${errors.residency ? 'search-field-invalid' : ''}`}>
            <label htmlFor="search-residency" className="search-label">
                {t('search.residency', 'جنسية الضيف (بلد جواز السفر)')}
            </label>
            <select
                id="search-residency"
                name="residency"
                required
                value={residency}
                aria-required="true"
                aria-invalid={String(Boolean(errors.residency))}
                aria-describedby={errors.residency ? 'search-residency-error' : 'search-residency-hint'}
                onChange={event => changeResidency(event.target.value)}
                className="search-input"
            >
                <option value="">{t('search.residencyPlaceholder', 'اختر بلد جواز السفر')}</option>
                {options.map(({ code, label }) => <option key={code} value={code}>{label} ({code.toUpperCase()})</option>)}
            </select>
        </div>
        <span id="search-residency-hint" className="sr-only">
            {t('search.residencyHint', 'اختر بلد جواز سفر الضيف؛ لا يعتمد الاختيار على موقعك أو لغة التطبيق.')}
        </span>
        <FieldError field="residency" message={errors.residency} />
    </div>;
}