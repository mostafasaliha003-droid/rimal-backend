import test from 'node:test';
import assert from 'node:assert/strict';
import codes from '../../../../shared/ratehawkResidencies.json' with { type: 'json' };
import { buildResidencyOptions, residencyLabel } from './residencyOptions.js';

// Preserve the previous algorithm as the compatibility oracle: each label is
// independently resolved and the language's native localeCompare orders it.
function legacyLabel(code, language = 'en') {
    if (!code) return '';
    try {
        const displayLanguage = ['ar', 'en', 'es'].includes(language) ? language : 'en';
        const label = new Intl.DisplayNames([displayLanguage], { type: 'region' }).of(code.toUpperCase());
        return label && label !== code.toUpperCase() ? label : code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

for (const language of ['ar', 'en', 'es']) {
    test(`all ${codes.length} residency labels and their order match the existing ${language} locale rules`, () => {
        const expected = codes.map(code => ({ code, label: legacyLabel(code, language) }))
            .sort((first, second) => first.label.localeCompare(second.label, language));
        const actual = buildResidencyOptions(codes, language);
        assert.equal(JSON.stringify(actual), JSON.stringify(expected));
        assert.deepEqual(new Set(actual.map(option => option.code)), new Set(codes));
        for (const { code, label } of actual) assert.equal(residencyLabel(code, language), label);
    });
}

test('standalone labels retain existing default, unknown-region and unsupported-language fallbacks', () => {
    for (const language of [undefined, 'fr', 'invalid_language']) {
        for (const code of ['', 'ae', 'us', 'zz', 'x']) {
            assert.equal(residencyLabel(code, language), legacyLabel(code, language));
        }
    }
});
