const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'frontend', 'dist');
const publicFiles = ['index.html', '404.html', 'sw.js', 'manifest.webmanifest', 'offline.html', 'icon-192.png', 'icon-512.png', 'robots.txt', 'sitemap.xml'];
const assetDirectories = ['assets', 'pillow'];
const assetFiles = assetDirectories.flatMap(directory =>
    fs.readdirSync(path.join(output, directory), { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => path.join(directory, entry.name))
);
const files = [...publicFiles, ...assetFiles];
const checkOnly = process.argv.includes('--check');

for (const file of files) {
    assert(fs.statSync(path.join(output, file)).isFile(), `Missing frontend build file: ${file}`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) {
    assert(publicFiles.includes(icon.src.replace(/^\//, '')), `Unpublished application icon: ${icon.src}`);
}

if (!checkOnly) {
    for (const directory of assetDirectories) fs.mkdirSync(path.join(root, directory), { recursive: true });
    for (const file of files) fs.copyFileSync(path.join(output, file), path.join(root, file));
}
for (const file of files) {
    assert(fs.readFileSync(path.join(root, file)).equals(fs.readFileSync(path.join(output, file))), `Stale site file: ${file}`);
}
console.log(`${checkOnly ? 'Verified' : 'Prepared'} ${files.length} frontend files in the repository root. No remote deployment performed.`);