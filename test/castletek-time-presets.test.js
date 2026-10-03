const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'wled00/data', name), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
const response = json => ({ok: true, json: async () => json});

// Run the shipped page and shared namespace helpers with controllable requests and
// select semantics: assigning an absent option yields an empty value, as in browsers.
function page(pathname = '/castletek/v1/settings/time', cachedPresets = null) {
  const ids = {}, names = {}, requests = [], timers = new Map(), toasts = [];
  let nextTimer = 0, cachedReads = 0, metadataReady;
  class Element {
    constructor(tag = 'input') {
      this.tagName = tag.toUpperCase();
      this.attributes = new Map();
      this.options = [];
      this.children = [];
      this._value = '';
      this._html = '';
      this.style = {};
      this.hidden = false;
      this.disabled = false;
    }
    get value() { return this._value; }
    set value(value) {
      value = String(value);
      this._value = this.tagName !== 'SELECT' || this.options.some(option => option.value === value) ? value : '';
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    get innerHTML() { return this._html; }
    set innerHTML(html) {
      this._html = html;
      if (this.tagName === 'SELECT') {
        this.options = Array.from(html.matchAll(/<option value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g), match => {
          const option = new Element('option');
          option.value = match[1];
          option.textContent = match[2];
          return option;
        });
        this._value = this.options[0]?.value ?? '';
      } else {
        this.children = [];
        this.insertAdjacentHTML('beforeend', html);
      }
    }
    appendChild(child) {
      this.children.push(child);
      if (child.name) names[child.name] = child;
      if (child.id) ids[child.id] = child;
      if (this.tagName === 'SELECT') {
        this.options.push(child);
        if (this.options.length === 1) this._value = child.value;
      }
    }
    insertAdjacentHTML(_, html) {
      for (const match of html.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)) {
        const select = new Element('select');
        select.name = match[1].match(/name="([^"]+)"/)?.[1];
        const id = match[1].match(/id="([^"]+)"/)?.[1];
        select.innerHTML = match[2];
        if (select.name) names[select.name] = select;
        if (id) ids[id] = select;
        this.children.push(select);
      }
    }
    querySelectorAll() { return this.children.flatMap(child => child.tagName === 'SELECT' ? [child] : child.querySelectorAll()); }
  }
  const document = {
    Sf: names,
    head: {appendChild() {}},
    createElement: tag => new Element(tag),
    getElementById: id => ids[id],
    getElementsByName: name => names[name] ? [names[name]] : []
  };
  for (const name of ['A0', 'A1', 'MC', 'MN', 'LT', 'LN', 'LTR', 'LNR', 'OL']) {
    const input = names[name] = new Element();
    input.name = name;
    input.value = '0';
    input.parentNode = {replaceChild(next) { names[name] = next; }};
  }
  for (const id of ['TMT', 'macros', 'buttonMacroSettings', 'cac', 'ctPresetStatus', 'ctPresetRetry', 'nativeTimerSettings', 'clockSettings', 'macroPresetInfo', 'countdownPresetSettings', 'alexaPresetSettings', 'macroAssignmentsHeading', 'timedLightPresetLabel', 'presetAssignments', 'timeSettingsHeading']) ids[id] = new Element('div');
  ids.buttonMacroSettings.children.push(ids.macros);
  ids.ctPresetStatus.hidden = ids.ctPresetRetry.hidden = true;
  const location = {pathname, protocol: 'https:', host: 'controller.example:8443', hostname: 'controller.example', port: '8443'};
  const ctx = vm.createContext({
    document, window: {location}, AbortController,
    localStorage: {getItem() { cachedReads++; return cachedPresets; }},
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      const pending = deferred();
      requests.push({url, options, ...pending});
      options.signal.addEventListener('abort', () => pending.reject(new Error('aborted')));
      return pending.promise;
    }
  });
  vm.runInContext(read('common.js'), ctx);
  vm.runInContext(read('settings_time.htm').match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  ctx.showToast = text => toasts.push(text);
  ctx.loadJS = (_, __, before, after) => { metadataReady = values => { before(); values(); after(); }; };
  ctx.getLoc();
  ctx.maxTimers = 10;
  return {ctx, ids, names, requests, timers, toasts, location,
    get cachedReads() { return cachedReads; },
    metadata(values) { metadataReady(values); }
  };
}

// Load metadata through the actual page lifecycle, retaining a native row beside
// the legacy macro value retained in Compatibility v1's complete form.
function readyPage(value = 7, pathname) {
  const p = page(pathname);
  p.ctx.S();
  p.metadata(() => {
    p.names.MN.value = value;
    p.ctx.addTimerRow(20, 0, value);
  });
  return p;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Compatibility cannot save before hidden native timer metadata has loaded', () => {
  const p = page();
  p.ctx.S();
  assert.match(read('settings_time.htm'), /onsubmit="return Wd\(\)"/);
  assert.equal(p.ctx.Wd(), false);
  assert.match(p.toasts[0], /still loading/);
  p.metadata(() => p.ctx.addTimerRow(20, 0, 7));
  assert.equal(p.ctx.Wd(), true);
  assert.equal(p.names.T0.value, '7');
});

test('Compatibility removes the native editor and round-trips every native timer field on time Save', async () => {
  const p = page();
  p.ctx.S();
  const rows = [
    [20, 35, 41, 255, 1, 2, 12, 30],
    [255, -60, 42, 126, 3, 4, 10, 29],
    [254, 60, 250, 129, 11, 20, 2, 14]
  ];
  p.metadata(() => rows.forEach(row => p.ctx.addTimerRow(...row)));
  assert.equal(p.ids.nativeTimerSettings.hidden, true);
  assert.equal(p.ids.TMT.children.length, 24);
  assert.equal(p.ids.TMT.children.every(input => input.type === 'hidden' && !input.disabled), true);
  const timerValues = () => Object.fromEntries(Object.entries(p.names)
    .filter(([name]) => /^[HNTWMDPE]\d+$/.test(name)).map(([name, input]) => [name, input.value]));
  const expected = Object.fromEntries(rows.flatMap((row, i) =>
    ['H', 'N', 'T', 'W', 'M', 'D', 'P', 'E'].map((field, j) => [field + i, String(row[j])])));
  assert.deepEqual(timerValues(), expected);
  p.requests[0].resolve(response({2: {n: 'Other preset'}}));
  await settle();
  p.ctx.Wd();
  assert.deepEqual(timerValues(), expected);
  assert.equal(p.names.T0.tagName, 'INPUT');
  assert.equal(p.ids.TS0, undefined);
  assert.equal(p.ids.W00, undefined);
});

test('Compatibility macro selectors fetch this controller without reading the stock preset cache', async () => {
  const p = readyPage(7, '/proxy/roof/castletek/v1/settings/time');
  assert.equal(p.cachedReads, 0);
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0].url, 'https://controller.example:8443/proxy/roof/castletek/v1/presets.json');
  assert.equal(p.requests[0].options.cache, 'no-store');
  p.requests[0].resolve(response({0: {}, 7: {n: 'Evening'}, 3: {n: 'Holiday'}}));
  await settle();
  assert.equal(p.names.MN.value, '7');
  assert.deepEqual(p.names.MN.options.map(option => option.value), ['0', '3', '7']);
  assert.equal(p.names.MN.options[2].textContent, '7: Evening');
  assert.equal(p.ids.ctPresetStatus.hidden, true);
  assert.equal(p.timers.size, 0);
  assert.equal(p.names.T0.value, '7');
});

test('presets arriving before metadata preserve loaded macro and missing timer values', async () => {
  const p = page();
  p.ctx.S();
  p.requests[0].resolve(response({2: {n: 'Porch'}}));
  await settle();
  assert.equal(p.names.MN.tagName, 'INPUT');
  p.metadata(() => {
    p.names.MN.value = 42;
    p.ctx.addTimerRow(20, 0, 41);
    p.ctx.addRow(0, 40, 2, 0);
  });
  assert.equal(p.names.MN.tagName, 'SELECT');
  assert.equal(p.names.MN.value, '42');
  assert.equal(p.names.T0.value, '41');
  assert.equal(p.names.MP0.value, '40');
  assert.equal(p.names.MP0.disabled, true);
  assert.match(p.names.MN.options.at(-1).textContent, /42: Preset name unavailable/);
});

test('late preset loading preserves a deliberate Default Action or changed macro selection', async () => {
  const p = readyPage(42);
  p.names.MN.value = '0';
  p.requests[0].resolve(response({41: {n: 'Evening'}, 43: {n: 'Late'}}));
  await settle();
  assert.equal(p.names.MN.value, '0');
  assert.equal(p.names.T0.value, '42');
  p.names.MN.value = '43';
  const loading = p.ctx.populatePresets();
  p.requests[1].resolve(response({41: {n: 'Evening'}}));
  await loading;
  assert.equal(p.names.MN.value, '43');
  assert.equal(p.names.T0.value, '42');
});

test('failed, invalid, and timed-out loads preserve macro selections and hidden timers and offer retry', async () => {
  for (const kind of ['http', 'json', 'shape', 'apiError', 'timeout']) {
    const p = readyPage(49);
    if (kind === 'http') p.requests[0].resolve({ok: false});
    if (kind === 'json') p.requests[0].resolve({ok: true, json: async () => { throw new Error('invalid JSON'); }});
    if (kind === 'shape') p.requests[0].resolve(response([]));
    if (kind === 'apiError') p.requests[0].resolve(response({error: 19}));
    if (kind === 'timeout') [...p.timers.values()][0]();
    await settle();
    assert.equal(p.names.MN.value, '49', kind);
    assert.equal(p.names.T0.value, '49', kind);
    assert.equal(p.ids.ctPresetRetry.hidden, false, kind);
    assert.match(p.ids.ctPresetStatus.textContent, /Existing selections are preserved/, kind);
    const retry = p.ctx.populatePresets();
    p.requests[1].resolve(response({49: {n: 'Recovered'}}));
    await retry;
    assert.equal(p.names.MN.options[1].textContent, '49: Recovered');
    assert.equal(p.ids.ctPresetRetry.hidden, true);
    assert.equal(p.timers.size, 0);
  }
});

test('older successes, errors, and responses for another controller cannot overwrite macro names', async () => {
  for (const staleError of [false, true]) {
    const p = readyPage(2);
    const newer = p.ctx.populatePresets();
    p.requests[1].resolve(response({2: {n: 'Newest'}}));
    await newer;
    if (staleError) p.requests[0].reject(new Error('late failure'));
    else p.requests[0].resolve(response({1: {n: 'Stale'}}));
    await settle();
    assert.equal(p.names.MN.options[1].textContent, '2: Newest');
    assert.equal(p.ids.ctPresetStatus.hidden, true);
    assert.equal(p.ids.ctPresetRetry.hidden, true);
    const changedController = p.ctx.populatePresets();
    p.ctx.locip = 'other.example/castletek/v1';
    p.requests[2].resolve(response({3: {n: 'Wrong controller'}}));
    await changedController;
    assert.equal(p.names.MN.options[1].textContent, '2: Newest');
  }
});

test('invalid preset IDs are omitted and names cannot inject options or markup into macro selectors', async () => {
  const p = readyPage(2);
  p.requests[0].resolve(response({
    0: {}, 1: null, 2: {n: '</option><script>bad()</script>&'}, 3: {n: 7},
    250: {n: 'Last'}, 251: {n: 'Not a preset'}, '03': {n: 'Alias'},
    metadata: {}, 4: [], 5: 'invalid'
  }));
  await settle();
  assert.deepEqual(p.names.MN.options.map(option => option.value), ['0', '2', '3', '250']);
  assert.match(p.ctx.sortedPresetOptions, /&lt;\/option&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;&amp;/);
  assert.doesNotMatch(p.ctx.sortedPresetOptions, /<script>/);
  assert.equal(p.names.MN.options[2].textContent, '3: Preset 3');
});

test('an empty preset file retains missing macro and timer IDs', async () => {
  const p = readyPage(42);
  p.requests[0].resolve(response({0: {}}));
  await settle();
  assert.equal(p.names.MN.value, '42');
  assert.equal(p.names.T0.value, '42');
  assert.deepEqual(p.names.MN.options.map(option => option.value), ['0', '42']);
  assert.equal(p.ids.ctPresetStatus.textContent, 'No saved presets. Save a preset first.');
  assert.equal(p.ids.ctPresetRetry.hidden, true);
});

test('stock WLED retains its visible timer editor and preset cache', () => {
  for (const pathname of ['/settings/time', '/api/castletek/v1/settings/time']) {
    const p = page(pathname, JSON.stringify({2: {n: 'Stock preset'}}));
    p.ctx.S();
    p.metadata(() => p.ctx.addTimerRow(20, 0, 2));
    assert.equal(p.cachedReads, 1);
    assert.equal(p.requests.length, 0);
    assert.equal(p.ids.nativeTimerSettings.hidden, false);
    assert.equal(p.names.T0.tagName, 'SELECT');
    assert.equal(p.names.T0.value, '2');
    assert.match(p.ctx.sortedPresetOptions, /2: Stock preset/);
    assert.equal(p.ids.ctPresetStatus.hidden, true);
  }
});

test('hidden timed-light-over and other assignments survive metadata and preset reloads', async () => {
  const p = page();
  p.ctx.S();
  p.metadata(() => {
    p.names.MC.value = '41'; p.names.A0.value = '42'; p.names.A1.value = '43'; p.names.MN.value = '7';
  });
  p.requests[0].resolve(response({7: {n:'Evening'}}));
  await settle();
  p.ctx.Wd();
  assert.equal(p.ids.presetAssignments.hidden, true);
  assert.equal(p.ctx.document.title, 'Date & Time');
  assert.equal(p.ids.timeSettingsHeading.textContent, 'Date & Time');
  assert.equal(p.names.MN.tagName, 'SELECT');
  assert.equal(p.names.MN.disabled, false);
  assert.equal(p.names.MN.value, '7');
  for (const [name, value] of [['MC','41'], ['A0','42'], ['A1','43']]) {
    assert.equal(p.names[name].tagName, 'INPUT', name);
    assert.equal(p.names[name].disabled, false, name);
    assert.equal(p.names[name].value, value, name);
  }
});
