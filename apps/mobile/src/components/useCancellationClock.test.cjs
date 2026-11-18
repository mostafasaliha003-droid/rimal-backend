/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTs(file, overrides = {}, cache = new Map()) {
  let full = path.resolve(__dirname, file);
  if (!fs.existsSync(full)) full += '.ts';
  if (path.extname(full) === '.json') return JSON.parse(fs.readFileSync(full, 'utf8'));
  if (cache.has(full)) return cache.get(full).exports;
  const module = { exports: {} };
  cache.set(full, module);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', code)(name => Object.hasOwn(overrides, name) ? overrides[name]
    : name.startsWith('.') ? loadTs(path.resolve(path.dirname(full), name), overrides, cache) : require(name), module, module.exports);
  return module.exports;
}
const model = loadTs('./cancellationPresentationModel.ts');
const start = Date.parse('2026-11-19T12:00:00Z');
function policies(cutoff) {
  const at = new Date(cutoff).toISOString();
  return { freeUntil: at, policies: [
    { startAt: null, endAt: at, amount: '0.00', currency: 'USD' },
    { startAt: at, endAt: null, amount: '10.0001', currency: 'USD' },
  ] };
}

// Deterministic hook lifecycle/timer harness. Actual React/native behaviour is
// separately checked by the browser fixture; no network or real device here.
function fixture() {
  let time = start, stateIndex = 0, effectIndex = 0, serial = 0, clockReads = 0;
  const states = [], effects = [], pending = [], timers = new Map(), listeners = new Set();
  const react = {
    useState(initial) {
      const index = stateIndex++;
      if (!Object.hasOwn(states, index)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(run, dependencies) {
      const index = effectIndex++, previous = effects[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) pending.push(() => {
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: run() };
      });
    },
  };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'useCancellationClock.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'Date', 'setTimeout', 'clearTimeout', source)(name => {
    if (name === 'react') return react;
    if (name === 'react-native') return { AppState: { addEventListener: (_event, fn) => {
      listeners.add(fn); return { remove: () => listeners.delete(fn) };
    } } };
    if (name === './cancellationPresentationModel') return model;
    throw new Error('Unexpected hook dependency');
  }, exports, { now: () => { clockReads++; return time; } }, (run, delay) => {
    const id = ++serial; timers.set(id, { run, at: time + delay, delay }); return id;
  }, id => timers.delete(id));
  return {
    render(sources) { stateIndex = 0; effectIndex = 0; return exports.useCancellationClock(sources); },
    effects() { while (pending.length) pending.shift()(); },
    advance(milliseconds) {
      const target = time + milliseconds;
      let turns = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        assert(++turns < 50, 'Timer loop');
        time = next[1].at; timers.delete(next[0]); next[1].run();
      }
      time = target;
    },
    jump(milliseconds) { time += milliseconds; },
    foreground() { for (const listener of listeners) listener('active'); },
    dispose() { for (const effect of effects) effect.cleanup?.(); },
    timers, listeners, now: () => time,
    clockReads: () => clockReads,
  };
}

test('the exact half-open cutoff changes a zero charge to the supplied fee without an extra millisecond', () => {
  const f = fixture(), source = policies(start + 1000);
  assert.equal(model.presentCancellation(source, f.render([source])).kind, 'free');
  f.effects(); f.advance(0); f.advance(999);
  assert.equal(model.presentCancellation(source, f.render([source])).kind, 'free');
  f.advance(1);
  const current = model.presentCancellation(source, f.render([source]));
  assert.equal(current.kind, 'fee');
  assert.equal(model.cancellationMoneyText(current.fee), 'USD 10.0001');
});

test('foreground reconciles an overdue clock and unmount removes every timer and listener', () => {
  const f = fixture(), source = policies(start + 1000);
  f.render([source]); f.effects(); f.advance(0);
  f.jump(5000); f.foreground();
  assert.equal(model.presentCancellation(source, f.render([source])).kind, 'fee');
  f.dispose();
  assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});

test('changed schedules never reuse the previous timestamp as an optimistic current fee', () => {
  const f = fixture(), original = policies(start + 1000);
  f.render([original]); f.effects(); f.advance(0); f.jump(5000);
  const replacement = policies(start + 3000);
  assert.equal(Number.isNaN(f.render([replacement])), true);
  assert.equal(model.presentCancellation(replacement, f.render([replacement])).kind, 'unknown');
  f.effects(); f.advance(0);
  assert.equal(model.presentCancellation(replacement, f.render([replacement])).kind, 'fee');
});

test('long deadlines clamp safely; an empty externally driven clock installs no foreground listener', () => {
  const f = fixture(), source = policies(start + 2_147_483_647 + 50_000);
  f.render([source]); f.effects(); f.advance(0);
  assert.equal([...f.timers.values()][0].delay, 2_147_483_647);
  f.dispose();
  const empty = fixture(); empty.render([]); empty.effects(); empty.advance(0);
  assert.equal(empty.listeners.size, 0); assert.equal(empty.timers.size, 0);
});

test('one epoch sample drives both the published summary time and its next scheduled boundary', () => {
  const f = fixture(), source = policies(start + 1000);
  f.render([source]); f.effects();
  let before = f.clockReads(); f.advance(0);
  assert.equal(f.clockReads() - before, 1);
  assert.equal([...f.timers.values()][0].at, start + 1000);
  before = f.clockReads(); f.foreground();
  assert.equal(f.clockReads() - before, 1);
});
