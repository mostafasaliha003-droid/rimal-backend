// Explicitly select fixture-based Node tests. Legacy smoke scripts can contact
// suppliers, so never include test-*.js merely because of their filename.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function testFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return testFiles(target);
        return entry.name.endsWith('.test.js') ? [target] : [];
    });
}

const files = fs.readdirSync(root).filter(name => /^test-.*\.js$/.test(name)
    && /require\(['"]node:test['"]\)/.test(fs.readFileSync(path.join(root, name), 'utf8')))
    .map(name => path.join(root, name));
files.push(...testFiles(path.join(root, 'test')), ...testFiles(path.join(root, 'frontend', 'src')));
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', env: process.env });
if (result.error) console.error('Unable to start fixture test suite.');
process.exitCode = result.status ?? 1;
