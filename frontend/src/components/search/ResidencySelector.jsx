import { useMemo } from 'react';
import { FieldError } from './SearchFeedback';
import { SUPPORTED_RESIDENCY_CODES } from './searchModel';
import { buildResidencyOptions } from './residencyOptions';
export { residencyLabel } from './residencyOptions';

export default function ResidencySelector({ controller }) {
    const { t, language, residency, changeResidency, errors } = controller;
    const options = useMemo(() => buildResidencyOptions(SUPPORTED_RESIDENCY_CODES, language), [language]);

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
