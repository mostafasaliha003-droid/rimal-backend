import pages from '../../../shared/pageRoutes.json';

const patterns = pages.patterns.map(source => new RegExp(source));
/** '/support/' and '/support' are the same page. */
export const cleanPath = pathname => (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname) || '/';

/** Whether the website has a page at this address. Anything else shows the "not found" page. */
export function knownRoute(pathname) {
    const path = cleanPath(pathname);
    return pages.routes.includes(path) || patterns.some(pattern => pattern.test(path));
}

/** The browser-tab title for a page, or null when the page keeps the site's default title. */
export function pageTitle(pathname, language) {
    const entry = pages.titles[knownRoute(pathname) ? cleanPath(pathname) : '404'];
    return entry ? entry[language] || entry.en : null;
}
