/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const m = load(path.resolve(__dirname, './mapHtml.ts'));

test('the map uses free OpenFreeMap tiles unless an https MapLibre style is configured', () => {
  assert.equal(m.mapStyleUrl(''), m.DEFAULT_MAP_STYLE);
  assert.equal(m.mapStyleUrl('http://insecure.example/style.json'), m.DEFAULT_MAP_STYLE);
  assert.equal(m.mapStyleUrl('not a url'), m.DEFAULT_MAP_STYLE);
  assert.equal(m.mapStyleUrl('https://api.maptiler.com/maps/streets-v2/style.json?key=public'), 'https://api.maptiler.com/maps/streets-v2/style.json?key=public');
  assert.match(m.DEFAULT_MAP_STYLE, /^https:\/\/tiles\.openfreemap\.org\//);
});

test('only real coordinates become markers', () => {
  const ok = { id: 1, latitude: 25.2, longitude: 55.27, label: 'USD 280', name: 'A' };
  assert.deepEqual(m.validMarkers([ok, { ...ok, id: 2, latitude: 120 }, { ...ok, id: 3, longitude: Number.NaN }, { ...ok, id: 1.5 }]), [ok]);
});

test('hotel names cannot break out of the map page script', () => {
  const html = m.buildMapHtml({ failure: 'x', markers: [{ id: 7, latitude: 25, longitude: 55, label: 'USD 1', name: '</script><img src=x onerror=alert(1)>\u2028' }] });
  assert.equal((html.match(/<\/script>/g) || []).length, 3);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('\\u003c/script\\u003e'));
  assert.ok(html.includes(m.MAPLIBRE.scriptIntegrity) && html.includes(m.MAPLIBRE.styleIntegrity));
  assert.ok(html.includes('crossorigin="anonymous"'));
});
