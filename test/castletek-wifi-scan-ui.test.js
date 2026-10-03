const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const page = fs.readFileSync(path.join(__dirname, '../wled00/data/settings_wifi.htm'), 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
const row = (ssid = 'CastleTek', rssi = -40, channel = 6) => ({ssid, rssi, channel});
const result = (state, networks = []) => ({networks, scan: {schema: 1, state}});

function harness(replies) {
  let now = 0, timerID = 0;
  const calls = [], timers = new Map(), abortLimits = [];
  const ids = {scan: {disabled: false, textContent: 'Scan'}, scanStatus: {hidden: true, textContent: ''}};
  let field;
  function element(tag) {
    const e = {tagName: tag.toUpperCase(), children: [], value: '', attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; if (k === 'value') this.value = v; },
      appendChild(child) { this.children.push(child); if (this.children.length === 1 || child.attributes.selected) this.value = child.value; },
      removeChild(child) { this.children = this.children.filter(c => c !== child); },
      replaceWith(replacement) { field = replacement; }, remove() {}};
    return e;
  }
  field = element('input');field.name = field.id = 'CS0';field.value = 'Your_Network';
  const document = {head: {appendChild() {}}, createElement: element, querySelectorAll() {return [field];}};
  const ctx = vm.createContext({document, d: document, gId: id => ids[id], cE: element,
    getURL: path => '/castletek/v1'+path, isCastleTekWLEDCompat: () => true,
    performance: {now: () => now}, AbortController, TypeError,
    setTimeout(fn, ms) {
      const id = ++timerID;
      if (ms === 1000) {now += ms;queueMicrotask(fn);} else {timers.set(id, {fn, ms});abortLimits.push(ms);}
      return id;
    }, clearTimeout(id) {timers.delete(id);},
    async fetch(url, options) {
      calls.push({url, cache: options.cache, hasSignal: !!options.signal});
      const next = replies[Math.min(calls.length-1, replies.length-1)];
      if (next.error) {now += Math.min(next.delay ?? 0, [...timers.values()].at(-1)?.ms ?? Infinity);throw next.error;}
      now += next.delay ?? 0;
      return {ok: (next.status ?? 200) === 200, status: next.status ?? 200,
        async json() {return next.json ?? next;}};
    }});
  vm.runInContext(script, ctx);
  return {ctx, ids, calls, abortLimits, timers, get field() {return field;}, get now() {return now;}};
}

test('browser polls one requested scan, then displays deduplicated 2.4 GHz results without another request', async () => {
  const h = harness([result('running'),result('running'),result('complete',[row('CastleTek',-65),row('CastleTek',-40),row('Other',-55),row('5 GHz',-30,36)])]);
  await h.ctx.N();
  assert.deepEqual(h.calls.map(c => c.url), ['/castletek/v1/json/net?refresh=1','/castletek/v1/json/net','/castletek/v1/json/net']);
  assert.deepEqual(h.field.children.map(c => c.value), ['CastleTek','Other','!Cs']);
  assert.match(h.ids.scanStatus.textContent, /Choose a network/);
  assert.equal(h.ids.scan.disabled, false);
  assert.equal(h.timers.size, 0);
  assert.ok(h.calls.every(c => c.cache === 'no-store' && c.hasSignal));
});

test('completed empty scan stops immediately and reports no networks', async () => {
  const h = harness([result('complete')]);await h.ctx.N();
  assert.equal(h.calls.length, 1);assert.match(h.ids.scanStatus.textContent, /^No available/);
});

test('legacy empty and running scans finish as incomplete, never as no networks', async () => {
  for (const response of [{networks: []}, result('running')]) {
    const h = harness([response]);await h.ctx.N();
    assert.equal(h.calls.length, 11);assert.equal(h.now, 10000);
    assert.match(h.ids.scanStatus.textContent, /did not finish/);assert.equal(h.ids.scan.disabled, false);
  }
});

test('failed and malformed scan states restore the button and keep failures distinct from empty results', async () => {
  for (const response of [result('failed'), {networks: [],scan: null}, {networks: [],scan: {schema: 2,state: 'complete'}}, {networks: [],scan: {schema: true,state: 'complete'}}, result('running',[row()]), {scan: {schema: 1,state: 'complete'}}]) {
    const h = harness([response]);await h.ctx.N();
    assert.equal(h.calls.length, 1);assert.match(h.ids.scanStatus.textContent, /could not finish/);
    assert.equal(h.ids.scan.disabled, false);assert.equal(h.timers.size, 0);
  }
});

test('transient HTTP failures retry only polling, permanent rejection stops', async () => {
  const h = harness([{status: 503},result('complete',[row()])]);await h.ctx.N();
  assert.equal(h.calls[1].url, '/castletek/v1/json/net');assert.match(h.ids.scanStatus.textContent,/Choose/);
  const rejected = harness([{status: 403}]);await rejected.ctx.N();assert.equal(rejected.calls.length, 1);
});

test('slow scan reads have an eight-second ceiling and cannot keep polling beyond thirty seconds', async () => {
  const h = harness([{error: {name: 'AbortError'},delay: 8000}]);await h.ctx.N();
  assert.equal(h.calls.length, 4);assert.deepEqual(h.abortLimits,[8000,8000,8000,3000]);
  assert.equal(h.now,30000);assert.match(h.ids.scanStatus.textContent,/did not finish/);
});

test('manual Scan Again starts fresh and refreshes an existing selector while preserving its selection', async () => {
  const h = harness([result('complete',[row()]), result('complete',[row(),row('New')])]);
  await h.ctx.N();await h.ctx.N();
  assert.ok(h.calls.every(c => c.url.endsWith('?refresh=1')));
  assert.equal(h.field.value,'CastleTek');assert.deepEqual(h.field.children.map(c => c.value),['CastleTek','New','!Cs']);
});

test('legacy firmware with completed rows remains usable', async () => {
  const h = harness([{networks:[row()]}]);await h.ctx.N();
  assert.equal(h.calls.length,1);assert.match(h.ids.scanStatus.textContent,/Choose/);
});
