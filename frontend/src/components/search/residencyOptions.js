function displayNamesFor(language) {
    const displayLanguage = ['ar', 'en', 'es'].includes(language) ? language : 'en';
    try {
        return new Intl.DisplayNames([displayLanguage], { type: 'region' });
    } catch {
        return null;
    }
}

function labelWithFormatter(code, displayNames) {
    if (!code) return '';
    const upperCode = code.toUpperCase();
    try {
        const label = displayNames?.of(upperCode);
        return label && label !== upperCode ? label : upperCode;
    } catch {
        return upperCode;
    }
}

export function residencyLabel(code, language = 'en') {
    return labelWithFormatter(code, displayNamesFor(language));
}

export function buildResidencyOptions(codes, language) {
    const displayNames = displayNamesFor(language);
    const collator = new Intl.Collator(language);
    return codes
        .map(code => ({ code, label: labelWithFormatter(code, displayNames) }))
        .sort((first, second) => collator.compare(first.label, second.label));
}
