const path = require('node:path');

// Keep Chrome in the deployed project, rather than a build-only home cache.
// The Staging build already runs `puppeteer browsers install chrome`.
module.exports = { cacheDirectory: path.join(__dirname, '.cache', 'puppeteer') };
