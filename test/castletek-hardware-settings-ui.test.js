const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'wled00/data', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const map = [16, 3, 1, 4];
const physical = (pins, count = pins.length) => ({ physical: true, count, pins });
const virtual = pins => ({ physical: false, count: pins.length, pins });

// Exercise the shipped shared helpers and page handlers with isolated controller metadata and form elements.
function context(outputs = [], pathname = '/castletek/v1/settings/leds') {
  const names = {}, ids = {}, sels = [], alerts = [];
  const element = (name = '', initial = '') => {
    let value = String(initial);
    return {
      name, get value() { return value; }, set value(next) { value = String(next); },
      dataset: {}, style: {}, attributes: {}, hidden: false, disabled: false,
      classList: { values: new Set(), toggle(name, enabled) { enabled ? this.values.add(name) : this.values.delete(name); }, contains(name) { return this.values.has(name); } },
      setAttribute(name, value) { this.attributes[name] = value; },
      setCustomValidity(message) { this.validationMessage = message; },
      querySelector() { return element(); },
      tagName: 'INPUT', type: 'number', focus() {}, querySelectorAll() { return []; }
    };
  };
  const document = {
    Sf: names,
    ledTypes: [
      { i: 22, t: 'D', c: 1 }, { i: 50, t: '2P', c: 1 }, { i: 42, t: 'AAA', c: 1 },
      { i: 80, t: 'N', c: 1 }, { i: 128, t: 'H', c: 1 }, { i: 110, t: 'V', c: 1 }
    ],
    ct_hw_policy: 1, ct_led_pins: map.slice(),
    head: { appendChild() {} }, createElement() { return element(); },
    getElementById(id) { return ids[id]; }, getElementsByName(name) { return names[name] ? [names[name]] : []; }
  };
  names.querySelectorAll = query => {
    if (query === '#mLC select[name^=LT]') return sels;
    if (query === '#mLC input[name^=L]') return Object.values(names).filter(field => field?.tagName === 'INPUT' && field.name?.startsWith('L'));
    if (query === '#mLC input[name^=MA]') return outputs.map((_, i) => names['MA'+i]);
    if (query === '#mLC select[name^=LAsel]') return outputs.map((_, i) => names['LAsel'+i]);
    return [];
  };
  for (const [i, output] of outputs.entries()) {
    const n = String.fromCharCode((i < 10 ? 48 : 55) + i);
    const sel = names['LT'+n] = element('LT'+n, output.type);
    sel.tagName = 'SELECT';
    sel.options = document.ledTypes.map(type => ({
      value: String(type.i), disabled: false, outputType: type.t,
      remove() { sel.options = sel.options.filter(option => option !== this); }
    }));
    sel.replaceChildren = (...options) => { sel.options = options; };
    sel.querySelectorAll = query => {
      if (query === 'option') return sel.options;
      const match = query.match(/data-type(\^?)="([^"]*)"/);
      return match ? sel.options.filter(option => match[1] ? option.outputType.startsWith(match[2]) : option.outputType === match[2]) : [];
    };
    sels.push(sel);
    names['LD'+n] = element('LD'+n, output.driver ?? 0);
    for (let p = 0; p < 5; p++) {
      names['L'+p+n] = element('L'+p+n, output.pins[p] ?? '');
      ids['p'+p+'d'+n] = element();
    }
    for (const [prefix, value] of Object.entries({LC: output.length ?? 40, LS: output.start ?? i*40, SL: 2, LA: 35, MA: 750, AW: 2, WO: 0, CO: 1, SP: 0, HS: 'retained'})) {
      names[prefix+n] = element(prefix+n, value);
    }
    names['LAsel'+n] = element('LAsel'+n, 35);
    names['LAsel'+n].tagName = 'SELECT';
    for (const prefix of ['EN', 'RF', 'CV']) {
      names[prefix+n] = element(prefix+n, prefix === 'EN' ? '1' : 'on');
      names[prefix+n].type = 'checkbox';
      names[prefix+n].checked = prefix === 'EN' ? output.enabled !== false : true;
    }
    const rowFields = Object.values(names).filter(field => field?.name?.endsWith(n) && field.name !== 'EN'+n);
    ids['ctOutputFields'+n] = element();
    ids['ctOutputFields'+n].querySelectorAll = () => rowFields;
    ids['ctOutputToggle'+n] = element();
    ids['ctOutputToggle'+n].hidden = true;
    ids['ctOutputName'+n] = element();
    ids['ctOutputStatus'+n] = element();
    ids['ctLastLEDLabel'+n] = element();
    ids['ctLastLED'+n] = element();
    ids['psd'+n] = element();
    ids['ls'+n] = names['LS'+n];
    ids['rf'+n] = names['RF'+n];
    ids['ctFixedPins'+n] = element();
  }
  names.AS = {checked: true};
  names.CTOP = element('CTOP', 2);
  names.CTOP.disabled = true;
  for (const name of ['MA', 'AW', 'IT', 'FR']) names[name] = element(name, name === 'MA' ? 2000 : 0);
  for (const name of ['ABL', 'PPL', 'CR']) names[name] = {checked: false};
  ids.ctAddOutputControls = element();
  ids.ctCustomStarts = element();
  ids.ctOutputRangeHelp = element();
  ids.ctLEDTotalLabel = element();
  ids.pc = element();
  for (const id of ['buttonSettings', 'irSettings', 'buttonMacroSettings', 'relaySettings', 'scheduleSettings', 'advancedLEDSettings', 'color_order_mapping']) {
    const fields = [element(id+'Input', 23), element(id+'Select', 7)];
    ids[id] = { hidden: false, fields, querySelectorAll() { return fields; } };
  }
  names.TL = element('TL', 60);
  names.TB = element('TB', 25);
  names.TW = element('TW', 2);
  names.TW.tagName = 'SELECT'; names.TW.type = 'select-one';
  ids.timedLightSettings = {hidden: false, fields: [names.TL, names.TB, names.TW],
    querySelectorAll() { return this.fields.filter(field => field.type === 'number'); }};
  const ctx = vm.createContext({ document, window: { location: {pathname} }, alert: message => alerts.push(message) });
  vm.runInContext(read('common.js'), ctx);
  const script = read('settings_leds.htm').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, ctx);
  ctx.nativeUI = ctx.UI;
  ctx.UI = () => {};
  ctx.testElement = element;
  ctx.ctLEDPinsReady = true;
  ctx.ctRememberLEDs();
  return {ctx, document, names, ids, sels, alerts};
}

test('fixed map requires current, complete, unique firmware metadata', () => {
  const {ctx} = context();
  assert.deepEqual(plain(ctx.castleTekFixedLEDPins(1, map)), map);
  for (const pins of [[], [16, 16], ['16'], [255], [-1], [true]]) {
    assert.equal(ctx.castleTekFixedLEDPins(1, pins), null);
  }
  assert.equal(ctx.castleTekFixedLEDPins(undefined, map), null);
  assert.deepEqual(plain(ctx.castleTekFixedLEDPins(2, map)), map);
  assert.equal(ctx.castleTekFixedLEDPins(3, map), null);
});

test('allocation preserves nonsequential existing connectors and uses first unused advertised pins', () => {
  const {ctx} = context();
  const rows = [physical([4]), virtual([192, 0, 2, 16]), physical([3]), physical([], 2)];
  assert.deepEqual(plain(ctx.castleTekPlanLEDPins(map, rows, 3)), [[4], [192, 0, 2, 16], [3], [16, 1]]);
  assert.deepEqual(rows[3].pins, []);
});

test('validation rejects unsupported, duplicate, missing, and exhausted physical pins without reassignment', () => {
  const {ctx} = context();
  for (const rows of [[physical([5])], [physical([16]), physical([16])], [physical([], 1)], [physical([true])]]) {
    assert.equal(ctx.castleTekPlanLEDPins(map, rows), null);
  }
  assert.equal(ctx.castleTekPlanLEDPins([16], [physical([16]), physical([], 1)], 1), null);
  assert.deepEqual(plain(ctx.castleTekPlanLEDPins(map, [physical([4]), virtual([64, 64, 4, 2, 2])])), [[4], [64, 64, 4, 2, 2]]);
});

test('type expansion retains data pin, adds free clock pin, and fails without changing existing pins when full', () => {
  const {ctx, names, sels, alerts} = context([{type:22,pins:[4]}, {type:22,pins:[16]}]);
  sels[0].value = '50';
  ctx.ctChangeLEDType(sels[0]);
  assert.equal(names.L00.value, '4');
  assert.equal(Number(names.L10.value), 3);
  assert.equal(ctx.ctPinsOK(), true);
  const occupied = context([{type:22,pins:[16]}, {type:42,pins:[3,1,4]}]);
  occupied.sels[0].value = '50';
  occupied.ctx.ctChangeLEDType(occupied.sels[0]);
  assert.equal(occupied.sels[0].value, '22');
  assert.equal(occupied.names.L00.value, '16');
  assert.equal(occupied.names.L10.value, '');
  assert.equal(occupied.alerts.length, 1);
  assert.equal(alerts.length, 0);
});

test('network to physical type ignores IP bytes; physical to network restores editable fields', () => {
  const {ctx, names, sels, ids} = context([{type:80,pins:[192,0,2,16]}, {type:22,pins:[4]}]);
  sels[0].value = '22';
  ctx.ctChangeLEDType(sels[0]);
  assert.equal(Number(names.L00.value), 16);
  ctx.ctShowFixedLEDs('0', 22);
  assert.equal(names.L00.readOnly, true);
  assert.equal(names.L00.style.display, 'none');
  assert.equal(ids.ctFixedPins0.textContent, 'LED1');
  sels[0].value = '80';
  ctx.ctChangeLEDType(sels[0]);
  ctx.ctShowFixedLEDs('0', 80);
  assert.equal(names.L00.readOnly, false);
  assert.equal(names.L00.style.display, 'inline');
  assert.equal(ids.ctFixedPins0.hidden, true);
});

test('older firmware preserves loaded pins and permits no invented additional GPIOs', () => {
  const {ctx, document, sels, names, ids} = context([{type:22,pins:[23]}]);
  delete document.ct_hw_policy;
  delete document.ct_led_pins;
  assert.equal(ctx.ctPinsOK(), true);
  ctx.ctShowFixedLEDs('0', 22);
  assert.equal(ids.ctFixedPins0.textContent, 'GPIO 23 (fixed)');
  assert.equal(names.L00.readOnly, true);
  sels[0].value = '50';
  ctx.ctChangeLEDType(sels[0]);
  assert.equal(sels[0].value, '22');
  names.L00.value = '16';
  assert.equal(ctx.ctPinsOK(), false);
});

test('failed recovery backup blocks settings submission without changing loaded connectors', () => {
  const {ctx, document, names} = context([{type:22,pins:[16]}]);
  assert.equal(ctx.ctPinsOK(), true);
  document.ct_cfg_backup_failed = 1;
  assert.equal(ctx.ctPinsOK(), false);
  assert.equal(names.L00.value, '16');
  document.ct_cfg_backup_failed = 0;
  assert.equal(ctx.ctPinsOK(), true);
});

test('new physical row allocates a fixed connector and falls back to an existing virtual type when full or unknown', () => {
  const first = context([{type:22,pins:[4]}, {type:22,pins:[]}]);
  first.ctx.ctPrepareNewLED('1');
  assert.equal(Number(first.names.L01.value), 16);
  const full = context([{type:42,pins:[16,3,1]}, {type:22,pins:[4]}, {type:22,pins:[]}]);
  full.ctx.ctPrepareNewLED('2');
  assert.equal(full.sels[2].value, '80');
  const old = context([{type:22,pins:[]}]);
  delete old.document.ct_hw_policy;
  old.ctx.ctPrepareNewLED('0');
  assert.equal(old.sels[0].value, '80');
});

test('full connectors remove unavailable physical choices and restore them after a connector is freed', () => {
  const {ctx, sels} = context([{type:42,pins:[16,3,1]}, {type:22,pins:[4]}, {type:80,pins:[192,0,2,1]}]);
  const refresh = () => { ctx.ctRestoreLEDTypes(sels); ctx.ctFilterLEDTypes(sels); };
  const values = index => sels[index].options.map(option => Number(option.value));
  refresh();
  assert.deepEqual(values(2), [80,128,110]);
  assert.deepEqual(values(1), [22,80,128,110]);
  assert.deepEqual(values(0), [22,50,42,80,128,110]);
  assert.deepEqual(sels.map(sel => sel.value), ['42','22','80']);
  sels[1].value = '80';
  refresh();
  assert.deepEqual(values(2), [22,80,128,110]);
  sels[0].value = '22';
  refresh();
  assert.deepEqual(values(2), [22,50,42,80,128,110]);
});

test('type choices preserve native bus limits and do not invent pins for incomplete metadata', () => {
  const {ctx, document, sels} = context([{type:22,pins:[16]}, {type:80,pins:[192,0,2,1]}]);
  ctx.ctRestoreLEDTypes(sels);
  sels[1].options.find(option => option.value === '50').disabled = true;
  ctx.ctFilterLEDTypes(sels);
  assert.deepEqual(sels[1].options.map(option => Number(option.value)), [22,42,80,128,110]);
  for (const policy of [undefined, 3]) {
    document.ct_hw_policy = policy;
    ctx.ctRestoreLEDTypes(sels);
    ctx.ctFilterLEDTypes(sels);
    assert.deepEqual(sels[1].options.map(option => Number(option.value)), [80,128,110]);
    assert.equal(sels[0].value, '22');
    assert.equal(sels[0].options.some(option => option.value === '22'), true);
  }
  document.ct_hw_policy = 1;
  document.ct_led_pins = [16,16];
  ctx.ctRestoreLEDTypes(sels);
  ctx.ctFilterLEDTypes(sels);
  assert.deepEqual(sels[1].options.map(option => Number(option.value)), [80,128,110]);
});

test('removed advanced and override controls retain saved override values for form serialization', () => {
  const {ctx, names, ids} = context();
  ctx.ctHideLEDSettings();
  assert.equal(names.AS.checked, false);
  assert.equal(ids.advancedLEDSettings.hidden, true);
  assert.ok(ids.advancedLEDSettings.fields.every(field => field.disabled));
  assert.equal(ids.color_order_mapping.hidden, true);
  assert.ok(ids.color_order_mapping.fields.every(field => !field.disabled));
  assert.deepEqual(ids.color_order_mapping.fields.map(field => field.value), ['23','7']);
  assert.equal(ids.timedLightSettings.hidden, true);
  assert.ok(ids.timedLightSettings.fields.every(field => !field.disabled));
  assert.deepEqual(ids.timedLightSettings.fields.map(field => [field.name, field.type, field.value]),
    [['TL','hidden','60'], ['TB','hidden','25'], ['TW','select-one','2']]);
});

test('templates retain hidden driver preferences by fixed connector instead of replacing them from template data', () => {
  const {ctx} = context([{type:22,pins:[4],driver:1}, {type:22,pins:[16],driver:0}, {type:80,pins:[192,0,2,1],driver:1}]);
  assert.deepEqual(plain(Array.from(ctx.ctTemplateDrivers())), [['[4]',1],['[16]',0]]);
  const {ctx: stock} = context([{type:22,pins:[4],driver:1}], '/settings/leds');
  assert.equal(stock.ctTemplateDrivers().size, 0);
  assert.match(read('settings_leds.htm'), /isCastleTekWLEDCompat\(\) \? ctDrivers\.get\(JSON\.stringify\(v\.pin\)\) \?\? 0 : v\.drv \| 0/);
});

test('retired sections are hidden and disabled while relay and schedule fields remain untouched', () => {
  const {ctx, ids} = context();
  for (const id of ['buttonSettings', 'irSettings', 'buttonMacroSettings']) ctx.castleTekHideSettings(id);
  for (const id of ['buttonSettings', 'irSettings', 'buttonMacroSettings']) {
    assert.equal(ids[id].hidden, true);
    assert.ok(ids[id].fields.every(field => field.disabled));
    assert.deepEqual(ids[id].fields.map(field => field.value), ['23', '7']);
  }
  for (const id of ['relaySettings', 'scheduleSettings']) {
    assert.equal(ids[id].hidden, false);
    assert.ok(ids[id].fields.every(field => !field.disabled));
  }
});

test('stock and authenticated URL contexts retain their existing settings behavior', () => {
  for (const pathname of ['/settings/leds', '/api/castletek/v1/settings/leds', '/proxy/api/castletek/v1/settings/leds']) {
    const {ctx, ids, names} = context([{type:22,pins:[23]}], pathname);
    ctx.castleTekHideSettings('buttonSettings');
    ctx.ctShowFixedLEDs('0', 22);
    ctx.ctRestoreLEDTypes([names.LT0]);
    ctx.ctFilterLEDTypes([names.LT0]);
    ctx.ctHideLEDSettings();
    assert.equal(ids.buttonSettings.hidden, false);
    assert.equal(ids.advancedLEDSettings.hidden, false);
    assert.equal(ids.color_order_mapping.hidden, false);
    assert.equal(ids.timedLightSettings.hidden, false);
    assert.ok(ids.timedLightSettings.fields.every(field => !field.disabled));
    assert.deepEqual(ids.timedLightSettings.fields.map(field => [field.name, field.type, field.value]),
      [['TL','number','60'], ['TB','number','25'], ['TW','select-one','2']]);
    assert.equal(names.AS.checked, true);
    assert.equal(names.LT0.options.length, 6);
    assert.equal(names.L00.readOnly, undefined);
    assert.equal(ctx.ctPinsOK(), true);
  }
});

test('template validation accepts exact advertised pins and virtual dimensions, rejecting conflicts before draft replacement', () => {
  const {ctx, names, document} = context([{type:22,pins:[4]}]);
  const template = outputs => ({hw:{led:{ins:outputs}}});
  assert.equal(ctx.ctTemplatePinsOK(template([{type:22,pin:[16]},{type:128,pin:[64,64,1,1,1]}])), true);
  for (const outputs of [[{type:22,pin:[5]}], [{type:22,pin:[16]},{type:22,pin:[16]}], [{type:22,pin:[]}], [{type:999,pin:[16]}]]) {
    assert.equal(ctx.ctTemplatePinsOK(template(outputs)), false);
    assert.equal(names.L00.value, '4');
  }
  delete document.ct_hw_policy;
  assert.equal(ctx.ctTemplatePinsOK(template([{type:22,pin:[4]}])), true);
  assert.equal(ctx.ctTemplatePinsOK(template([{type:22,pin:[16]}])), false);
});

test('page integration keeps hidden metadata targets, protects template button/IR values, and guards submit before mutation', () => {
  const leds = read('settings_leds.htm'), time = read('settings_time.htm');
  assert.match(leds, /id="buttonSettings"[\s\S]*?id="btns"/);
  assert.match(leds, /id="irSettings"[\s\S]*?name="IR"/);
  assert.match(time, /id="buttonMacroSettings"[\s\S]*?id="macros"/);
  assert.match(leds, /if \(b && !isCastleTekWLEDCompat\(\)\)/);
  assert.match(leds, /if \(ir && !isCastleTekWLEDCompat\(\)\)/);
  assert.match(leds, /if\(c\.hw\.com && !isCastleTekWLEDCompat\(\)\)/);
  assert.match(leds, /localStorage\.getItem\('ASc'\)==='true' && !isCastleTekWLEDCompat\(\)/);
  const importGuard = leds.indexOf('if (!ctTemplatePinsOK(c))');
  assert.ok(importGuard >= 0 && importGuard < leds.indexOf('// remove all existing outputs'));
  const submit = leds.slice(leds.indexOf('function trySubmit('), leds.indexOf('function enABL('));
  assert.ok(submit.indexOf('if (!ctPinsOK())') < submit.indexOf('d.Sf.submit()'));
  assert.match(leds, /b\.insertAdjacentHTML\("beforeend", c\);\s*castleTekHideSettings\('buttonSettings'\)/);
  assert.match(time, /gId\("macros"\)\.appendChild\(buttonBlock\);\s*castleTekHideSettings\('buttonMacroSettings'\)/);
});


function fixedContext(pins = map) {
  const result = context(pins.map((pin, i) => ({type:22, pins:[pin], enabled:i === 0, start:i*100, length:40, driver:0})));
  result.document.ct_hw_policy = 2;
  result.document.ct_led_pins = pins.slice();
  result.document.ct_output_count = pins.length;
  result.ctx.bLimits(4, 2048, 64000, 8192, 5, 16, 8, 8, 16, 4);
  return result;
}

// HTML successful controls exclude disabled fields and unchecked checkboxes, but not inert descendants.
function activeRangeContext(pins = map) {
  const result = fixedContext(pins);
  result.document.ct_active_output_ranges = 1;
  useNativeUI(result);
  result.ctx.UI();
  return result;
}

function successfulRowFields(names) {
  return Object.fromEntries(Object.values(names).filter(field => field?.name && /^(L[TCDAS0-4]|MA|AW|WO|CO|SP|HS|EN|RF|CV|SL|CTOP)/.test(field.name) && !field.disabled &&
    (field.type !== 'checkbox' || field.checked)).map(field => [field.name, field.value]));
}

function useNativeUI(result) {
  const {ctx, ids} = result;
  ctx.gId = id => ids[id] ??= ctx.testElement();
  ctx.UI = ctx.nativeUI;
}

test('policy 2 retains every fixed connector in board order and rejects missing, reordered or extra rows', () => {
  for (const pins of [map, [16]]) {
    const {ctx, document, names, sels} = fixedContext(pins);
    assert.equal(ctx.ctPinsOK(), true);
    delete document.ct_output_count;
    assert.equal(ctx.ctPinsOK(), false, 'an incomplete metadata script cannot authorize saving');
    document.ct_output_count = pins.length;
    names.CTOP.value = '1';
    assert.equal(ctx.ctPinsOK(), false);
    names.CTOP.value = '2';
    names.EN0.checked = false;
    assert.equal(ctx.ctPinsOK(), true, 'all connectors may be disabled without removing rows');
    delete names.EN0;
    assert.equal(ctx.ctPinsOK(), false, 'enable metadata targets must exist');
    names.EN0 = {checked:false};
    names.L00.value = '5';
    assert.equal(ctx.ctPinsOK(), false);
    names.L00.value = pins[0];
    document.ct_led_pins = pins.concat(23);
    assert.equal(ctx.ctPinsOK(), false);
    document.ct_led_pins = pins;
    sels.push(sels[0]);
    assert.equal(ctx.ctPinsOK(), false);
  }
});

test('policy 2 offers only single-pin physical types and cannot add, remove or convert a fixed connector', () => {
  const {ctx, sels, names, ids} = fixedContext();
  ctx.ctRestoreLEDTypes(sels);
  ctx.ctFilterLEDTypes(sels);
  assert.deepEqual(sels.map(sel => sel.options.map(option => Number(option.value))), [[22],[22],[22],[22]]);
  const before = successfulRowFields(names);
  for (const count of [-1, 1]) for (const initialize of [false, true]) ctx.addLEDs(count, initialize);
  assert.deepEqual(successfulRowFields(names), before);
  for (const unsupported of [50,42,80,128,110]) {
    sels[0].value = unsupported;
    ctx.ctChangeLEDType(sels[0]);
    assert.equal(sels[0].value, '22');
  }
  ctx.ctHideLEDSettings();
  assert.equal(ids.ctAddOutputControls.hidden, true);
  const legacy = context([{type:22,pins:[16]}]);
  legacy.ctx.ctHideLEDSettings();
  assert.equal(legacy.ids.ctAddOutputControls.hidden, true);
});

test('disabled connector is grey and inert while all retained configuration remains in the complete form', () => {
  const result = fixedContext(), {ctx, names, ids} = result;
  useNativeUI(result);
  ctx.UI();
  const before = successfulRowFields(names);
  const starts = map.map((_, i) => names['LS'+i].value);
  names.EN0.checked = false;
  ctx.ctChangeOutputEnabled('0');
  assert.equal(ids.ctOutputFields0.inert, true);
  assert.equal(ids.ctOutputFields0.classList.contains('ctOutputDisabled'), true);
  assert.equal(ids.ctOutputFields0.attributes['aria-disabled'], 'true');
  assert.equal(ids.ctOutputToggle0.hidden, false);
  assert.equal(ids.ctOutputName0.textContent, 'LED1');
  const after = successfulRowFields(names);
  delete before.EN0;
  assert.deepEqual(after, before, 'only the unchecked enable field is omitted');
  assert.deepEqual(map.map((_, i) => names['LS'+i].value), starts);
  names.EN0.checked = true;
  ctx.ctChangeOutputEnabled('0');
  assert.equal(ids.ctOutputFields0.inert, false);
  assert.equal(ids.ctOutputFields0.classList.contains('ctOutputDisabled'), false);
  assert.equal(successfulRowFields(names).EN0, '1');
  assert.equal(successfulRowFields(names).CTOP, '2');
  assert.equal(names.LC0.value, '40');
  assert.equal(names.LD0.value, '0');
});

test('legacy policy 2 without active-range capability retains logical address space while disabled channels use no hardware', () => {
  const result = fixedContext(), {ctx, names, ids} = result;
  useNativeUI(result);
  ctx.UI();
  assert.equal(ctx.getDuse().rmtUsed, 1);
  assert.equal(ctx.getMem(22, '1'), 0);
  assert.equal(ctx.isBCok('1', {rmtUsed:100}), true);
  assert.equal(ids.lc.textContent, 340);
  assert.equal(ids.pc.textContent, 'Enabled LEDs: 40');
  names.EN0.checked = false;
  ctx.ctChangeOutputEnabled('0');
  assert.equal(ctx.getDuse().rmtUsed, 0);
  assert.equal(ids.m0.innerHTML, 0);
  assert.equal(ids.pc.textContent, 'Enabled LEDs: 0');
  assert.equal(ids.lc.textContent, 340);
});

test('policy 2 template checks reject topology changes and preserve hidden fields on accepted fixed rows', () => {
  const {ctx, names} = fixedContext();
  const rows = map.map((pin, i) => ({type:22,pin:[pin],enabled:i !== 0,len:75}));
  const template = ins => ({hw:{led:{ins}}});
  assert.equal(ctx.ctTemplatePinsOK(template(rows)), true);
  for (const invalid of [rows.slice(1), rows.concat(rows[0]), rows.toReversed(), rows.map((row, i) => i === 0 ? {...row, type:80} : row),
    rows.map((row, i) => i === 0 ? {...row, pin:[16,3],type:50} : row), rows.map((row, i) => i === 0 ? {...row, enabled:1} : row)]) {
    assert.equal(ctx.ctTemplatePinsOK(template(invalid)), false);
  }
  names.LD0.value = '1';
  const previous = ['LS0','SL0','HS0','LD0','RF0'].map(name => names[name].value);
  ctx.ctApplyFixedTemplate({ins:rows});
  assert.deepEqual(['LS0','SL0','HS0','LD0','RF0'].map(name => names[name].value), previous);
  assert.equal(names.LC0.value, '75');
  assert.equal(names.EN0.checked, false);
  assert.equal(names.EN1.checked, true);
});


test('legacy policy 2 without active-range capability preserves automatic starts and toggle behavior', () => {
  const result = fixedContext(), {ctx, names, ids} = result;
  useNativeUI(result);
  [10,1,1,1].forEach((length, i) => { names['LC'+i].value = length; names['LS'+i].value = i ? 9+i : 0; });
  names.LC0.value = '100';
  ctx.ctChangeLEDLength();
  const starts = () => map.map((_, i) => names['LS'+i].value);
  assert.deepEqual(starts(), ['0','100','101','102']);
  assert.equal(ids.lc.textContent, 103);
  assert.equal(names.LC1.value, '1');
  assert.equal(names.LD1.value, '0');
  for (const enabled of [true, false]) {
    names.EN1.checked = enabled;
    ctx.ctChangeOutputEnabled('1');
    assert.deepEqual(starts(), ['0','100','101','102']);
  }
  ctx.customStarts = true;
  names.LC0.value = '200';
  ctx.ctChangeLEDLength();
  assert.deepEqual(starts(), ['0','100','101','102']);
});


test('loaded legacy lengths retain a bounded same-connector same-type allowance independent of draft snapshots', () => {
  const result = fixedContext(), {ctx, names, sels, document} = result;
  names.LC0.value = '3000';
  ctx.ctRememberLoadedLEDLengths();
  useNativeUI(result);
  ctx.UI();
  assert.equal(names.LC0.max, 3000);
  assert.equal(Number(names.LC0.value) <= names.LC0.max, true);
  names.LC0.value = '2600';
  ctx.UI();
  assert.equal(names.LC0.max, 3000, 'reductions keep the initial source ceiling');
  names.LC0.value = '3001';
  ctx.ctRememberLEDs();
  ctx.UI();
  assert.equal(names.LC0.max, 3000);
  assert.equal(Number(names.LC0.value) <= names.LC0.max, false);
  names.EN0.checked = false;
  ctx.ctChangeOutputEnabled('0');
  assert.equal(names.LC0.max, 3000, 'disabled retained rows use the same valid range');
  document.ledTypes.push({i:30,t:'D',c:3});
  assert.equal(ctx.ctLEDLengthMax('0', 30), 2048, 'a different output type has no old-length allowance');
  assert.equal(ctx.ctLEDLengthMax('1', 22), 2048, 'another connector cannot borrow the allowance');
  const rows = map.map((pin, i) => ({type:22,pin:[pin],enabled:i === 0,len:i === 0 ? 4000 : 1}));
  ctx.ctApplyFixedTemplate({ins:rows});
  ctx.ctRememberLEDs();
  assert.equal(ctx.ctLEDLengthMax('0', 22), 3000, 'template import cannot increase the original ceiling');
  names.L00.value = '4';
  assert.equal(ctx.ctLEDLengthMax('0', 22), 2048, 'changed pin assignments cannot reuse the allowance');
  names.L00.value = '16';
  sels[0].dataset.ctLoadedLength = '8193';
  assert.equal(ctx.ctLEDLengthMax('0', 22), 2048, 'global maximum still bounds legacy evidence');
});


test('active ranges retain four grey disabled rows without allocating their saved addresses', () => {
  const {ctx, names, ids, sels} = activeRangeContext([16,17,18,19]);
  assert.equal(sels.length, 4);
  assert.equal(ids.lc.textContent, 40);
  assert.equal(ids.pc.textContent, 'Enabled LEDs: 40');
  assert.equal(ids.ctCustomStarts.hidden, true);
  assert.equal(ids.ctOutputRangeHelp.hidden, false);
  assert.equal(names.LS0.readOnly, false);
  assert.equal(names.LS0.disabled, false);
  assert.equal(ids.psd0.textContent, 'Start LED:');
  for (let i=1; i<4; i++) {
    assert.equal(ids['ctOutputFields'+i].inert, true);
    assert.equal(ids['ctOutputFields'+i].classList.contains('ctOutputDisabled'), true);
    assert.equal(ids['ctOutputStatus'+i].textContent, ' Disabled');
    assert.equal(names['LS'+i].value, String(i*100));
    assert.equal(ids['ctLastLED'+i].value, String(i*100+39));
    assert.equal(ctx.getMem(22, String(i)), 0);
  }
  const before = successfulRowFields(names);
  names.EN0.checked = false;
  ctx.ctChangeOutputEnabled('0');
  delete before.EN0;
  assert.deepEqual(successfulRowFields(names), before);
  assert.equal(ids.lc.textContent, 0);
  assert.equal(ids.pc.textContent, 'Enabled LEDs: 0');
  assert.equal(ctx.getDuse().rmtUsed, 0);
  assert.equal(ctx.ctOutputRangesOK(), true);
});

test('active outputs enable in LED1 LED3 LED2 order and retain editable independent ranges', () => {
  const {ctx, names, ids} = activeRangeContext();
  [10,1,1,1].forEach((length, i) => { names['LC'+i].value = length; names['LS'+i].value = i ? 9+i : 0; });
  ctx.UI();
  names.EN2.checked = true;
  ctx.ctChangeOutputEnabled('2');
  assert.equal(names.LS2.value, '10');
  assert.equal(names.LC2.value, '1');
  assert.equal(ids.ctLastLED2.value, '10');
  names.LC2.value = '20';
  ctx.ctChangeLEDLength();
  names.EN1.checked = true;
  ctx.ctChangeOutputEnabled('1');
  assert.equal(names.LS1.value, '30');
  assert.equal(names.LC1.value, '1');
  assert.equal(ids.ctLastLED1.value, '30');
  assert.equal(ids.lc.textContent, 31);
  names.LS1.value = '50';
  ctx.ctChangeLEDStart('1');
  names.LC0.value = '15';
  ctx.ctChangeLEDLength();
  assert.deepEqual(map.map((_, i) => names['LS'+i].value), ['0','50','10','12']);
  assert.equal(ids.ctLastLED0.value, '14');
  assert.equal(ids.ctLastLED1.value, '50');
  assert.equal(ids.lc.textContent, 51);
  assert.equal(names.LS1.readOnly, false);
});

test('reenabling appends after enabled ranges only and first enabled output starts at zero', () => {
  const {ctx, names, ids} = activeRangeContext();
  names.EN2.checked = true;
  ctx.ctChangeOutputEnabled('2');
  names.LS2.value = '90';
  ctx.ctChangeLEDStart('2');
  names.EN0.checked = false;
  ctx.ctChangeOutputEnabled('0');
  names.EN0.checked = true;
  ctx.ctChangeOutputEnabled('0');
  assert.equal(names.LS0.value, '130');
  assert.equal(names.LC0.value, '40');
  assert.equal(ids.ctLastLED0.value, '169');
  names.EN0.checked = false;
  names.EN2.checked = false;
  ctx.UI();
  names.EN3.checked = true;
  ctx.ctChangeOutputEnabled('3');
  assert.equal(names.LS3.value, '0');
  assert.equal(names.LC3.value, '40');
  assert.equal(ids.lc.textContent, 40);
});

test('inclusive last LED and length are synchronized while native form keeps only start and length', () => {
  const {ctx, names, ids} = activeRangeContext();
  names.LS0.value = '0';
  names.LC0.value = '10';
  ctx.ctChangeLEDLength();
  assert.equal(ids.ctLastLED0.value, '9');
  ids.ctLastLED0.value = '24';
  ctx.ctChangeLastLED('0');
  assert.equal(names.LC0.value, '25');
  assert.equal(names.LS0.value, '0');
  names.LS0.value = '20';
  ctx.ctChangeLEDStart('0');
  assert.equal(ids.ctLastLED0.value, '44');
  names.LC0.value = '5';
  ctx.ctChangeLEDLength();
  assert.equal(ids.ctLastLED0.value, '24');
  assert.equal(ctx.ctOutputRangesOK(), true);
  assert.equal(ids.ctLastLED0.validationMessage, '');
  const fields = successfulRowFields(names);
  assert.equal(fields.LS0, '20');
  assert.equal(fields.LC0, '5');
  assert.equal(Object.keys(fields).some(name => name.includes('Last')), false);
  assert.match(read('settings_leds.htm'), /id="ctLastLED\$\{s\}"[^>]*oninput="ctChangeLastLED/);
  assert.match(read('settings_leds.htm'), /Start LED 0 through Last LED 9 means 10 LEDs/);
});

test('invalid last LED drafts stay visible and block saving without a controller submission', () => {
  for (const last of ['', '-1', '1.5', '8192']) {
    const {ctx, names, ids, alerts} = activeRangeContext();
    ids.ctLastLED0.value = last;
    ctx.ctChangeLastLED('0');
    assert.equal(ids.ctLastLED0.value, last);
    assert.equal(ctx.ctOutputRangesOK(), false);
    assert.notEqual(ids.ctLastLED0.validationMessage, '');
    assert.equal(Number.isFinite(ids.m0.innerHTML), true, 'incomplete range cannot display NaN memory');
    if (last === '' || last === '-1' || last === '1.5') assert.equal(ids.m0.innerHTML, 0);
    names.data = {value:'stale'};
    names.submit = () => assert.fail('invalid range must not submit');
    let prevented = false, stopped = false;
    assert.equal(ctx.trySubmit({preventDefault() { prevented=true; }, stopPropagation() { stopped=true; }}), false);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(alerts.at(-1).includes('Start LED, Last LED, and Length'), true);
  }
  const {ctx, names, ids} = activeRangeContext();
  names.LS0.value = '20';
  ctx.ctChangeLEDStart('0');
  ids.ctLastLED0.value = '19';
  ctx.ctChangeLastLED('0');
  assert.equal(names.LC0.value, '0');
  assert.equal(ctx.ctOutputRangesOK(), false);
  ids.ctLastLED0.value = '29';
  ctx.ctChangeLastLED('0');
  assert.equal(names.LC0.value, '10');
  assert.equal(ctx.ctOutputRangesOK(), true);
});

test('empty fractional and overflowing start or length values cannot authorize save or another enable', () => {
  for (const [field, value] of [['LS0',''], ['LS0','-1'], ['LS0','0.5'], ['LS0','8190'], ['LC0',''], ['LC0','0'], ['LC0','1.5'], ['LC0','2049']]) {
    const {ctx, names} = activeRangeContext();
    names[field].value = value;
    ctx.UI();
    assert.equal(ctx.ctOutputRangesOK(), false, field+'='+value);
    names.EN1.checked = true;
    ctx.ctChangeOutputEnabled('1');
    assert.equal(names.EN1.checked, false, 'do not choose a start from an invalid enabled range');
    assert.equal(names.LS1.value, '100');
  }
  const {ctx, names, ids} = activeRangeContext();
  names.LS0.value = '8191';
  names.LC0.value = '1';
  ctx.UI();
  assert.equal(ids.ctLastLED0.value, '8191');
  assert.equal(ctx.ctOutputRangesOK(), true);
  names.EN1.checked = true;
  ctx.ctChangeOutputEnabled('1');
  assert.equal(names.LS1.value, '8192');
  assert.equal(ctx.ctOutputRangesOK(), false, 'a full address range must be edited before saving another output');
});

test('active-range capability is explicit and cannot change stock or legacy row editing', () => {
  for (const capability of [undefined,0,2,true,'1']) {
    const result = fixedContext(), {ctx, document, ids, names} = result;
    document.ct_active_output_ranges = capability;
    useNativeUI(result);
    ctx.UI();
    assert.equal(ctx.ctActiveOutputRanges(), false);
    assert.equal(ids.ctCustomStarts.hidden, false);
    assert.equal(ids.ctOutputRangeHelp.hidden, true);
    assert.equal(ids.ctLastLED0.disabled, true);
    assert.equal(ids.ctLastLEDLabel0.hidden, true);
    assert.equal(names.LS0.readOnly, true);
  }
  const stock = context([{type:22,pins:[16]}], '/settings/leds');
  stock.document.ct_hw_policy = 2;
  stock.document.ct_active_output_ranges = 1;
  stock.document.ct_output_count = 1;
  useNativeUI(stock);
  stock.ctx.makePinSelect = name => { stock.names[name].tagName = 'SELECT'; };
  stock.ctx.UI();
  assert.equal(stock.ctx.ctActiveOutputRanges(), false);
  assert.equal(stock.ids.ctLastLED0.disabled, true);
  assert.equal(stock.ids.ctLastLEDLabel0.hidden, true);
  assert.equal(stock.names.LS0.disabled, true);
});


test('an incomplete last LED keeps other output memory estimates and recovers when corrected', () => {
  const {ctx, names, ids} = activeRangeContext();
  names.EN1.checked = true;
  ctx.ctChangeOutputEnabled('1');
  const otherMemory = ctx.getMem(22, '1');
  ids.ctLastLED0.value = '';
  ctx.ctChangeLastLED('0');
  assert.equal(ctx.getMem(22, '0'), 0);
  assert.equal(ids.m0.innerHTML, otherMemory);
  assert.equal(ctx.ctOutputRangesOK(), false);
  ids.ctLastLED0.value = '9';
  ctx.ctChangeLastLED('0');
  assert.equal(names.LC0.value, '10');
  assert.equal(ids.m0.innerHTML, otherMemory + ctx.getMem(22, '0'));
  assert.ok(ids.m0.innerHTML > otherMemory);
  assert.equal(ctx.ctOutputRangesOK(), true);
});


test('Dig-Quad browser keeps relay GPIO 15 visible and read-only without a clear control', () => {
  const {ctx, document, names, ids} = context();
  document.ct_relay_pin = 15;
  names.RL = ctx.testElement('RL', 15);
  ids.ctClearRelay = ctx.testElement();
  ids.btns = ctx.testElement();
  ctx.makePinSelect = () => { throw new Error('Fixed relay must not become a pin picker'); };
  ctx.pinDropdowns();
  assert.equal(names.RL.value, '15');
  assert.equal(names.RL.readOnly, true);
  assert.equal(names.RL.disabled, false); // still present in the complete form
  assert.equal(ids.ctClearRelay.hidden, true);
});


// Match actual firmware driver IDs and labels rather than replacing source metadata.
function digQuadPickerContext(type = 30, pathname = '/castletek/v1/settings/leds', marker = 1) {
  const result = context([{type, pins:[16]}], pathname);
  const {document, sels} = result;
  const constants = fs.readFileSync(path.join(root, 'wled00/const.h'), 'utf8');
  const busSource = fs.readFileSync(path.join(root, 'wled00/bus_manager.cpp'), 'utf8');
  const digitalTypes = busSource.match(/std::vector<LEDType> BusDigital::getLEDTypes\(\) \{([\s\S]*?)\n\}/)[1];
  document.ledTypes = Array.from(digitalTypes.matchAll(/^\s*\{(TYPE_\w+),\s*"([^"]*)",\s*PSTR\("([^"]*)"\)\}/gm), match => ({
    i: Number(constants.match(new RegExp('^#define ' + match[1] + '\\s+(\\d+)', 'm'))[1]), t:match[2], n:match[3], c:1
  })).concat([{i:40,t:'',n:'On/Off',c:0},{i:41,t:'A',n:'PWM White',c:2}]);
  for (const sel of sels) {
    sel.options = document.ledTypes.map(type => ({
      value:String(type.i), text:type.n, disabled:false, outputType:type.t,
      remove() { sel.options = sel.options.filter(option => option !== this); }
    }));
  }
  document.ct_hw_policy = 2;
  document.ct_led_type_picker = marker;
  result.refresh = () => { result.ctx.ctRestoreLEDTypes(sels); result.ctx.ctFilterLEDTypes(sels); };
  return result;
}

test('standard Dig-Quad LED picker matches native labels/order and omits retired and unrelated output families', () => {
  const result = digQuadPickerContext();
  result.refresh();
  assert.deepEqual(result.sels[0].options.map(option => [Number(option.value), option.text]), [
    [28,'FW1906 GRBCW'], [30,'SK6812/WS2814 RGBW'], [34,'SM16825 RGBCW'], [31,'TM1814'], [25,'TM1829'], [33,'TM1914'],
    [26,'UCS8903'], [29,'UCS8904 RGBW'], [32,'WS2805 RGBCW'], [19,'WS2811 White'], [22,'WS281x'], [21,'WS281x WWA']
  ]);
  assert.equal(result.names.LT0.value, '30');
  assert.ok([24,27].every(id => result.document.ledTypes.some(type => type.i === id)), 'driver metadata stays available for installed outputs');
});

test('retired types remain selected and serialized until explicitly changed, then cannot be reselected', () => {
  for (const type of [24,27]) {
    const result = digQuadPickerContext(type), {names, sels} = result;
    const before = successfulRowFields(names);
    result.refresh();
    assert.equal(names.LT0.value, String(type));
    assert.ok(sels[0].options.some(option => Number(option.value) === type));
    assert.ok(sels[0].options.every(option => ![24,27].includes(Number(option.value)) || Number(option.value) === type));
    names.LC0.value = '55';
    result.refresh();
    assert.deepEqual(successfulRowFields(names), {...before, LC0:'55'});
    names.LT0.value = '30';
    result.refresh();
    assert.equal(names.LT0.value, '30');
    assert.ok(sels[0].options.every(option => ![24,27].includes(Number(option.value))));
  }
  for (const type of [40,41,50]) {
    const result = digQuadPickerContext(type);
    result.refresh();
    assert.equal(result.names.LT0.value, String(type));
    assert.ok(result.sels[0].options.some(option => Number(option.value) === type), 'retain existing alternate output family');
  }
});

test('generic, stock and authenticated profiles retain their original LED picker options', () => {
  for (const [pathname, marker] of [
    ['/castletek/v1/settings/leds',undefined], ['/castletek/v1/settings/leds',true],
    ['/settings/leds',1], ['/api/castletek/v1/settings/leds',1]
  ]) {
    const result = digQuadPickerContext(30, pathname, marker);
    // The default argument above intentionally models present metadata; explicitly omit it here.
    if (marker === undefined) delete result.document.ct_led_type_picker;
    result.refresh();
    const ids = result.sels[0].options.map(option => Number(option.value));
    assert.ok(ids.includes(24) && ids.includes(27));
    assert.equal(ids[0],22);
  }
  const xml = fs.readFileSync(path.join(root, 'wled00/xml.cpp'), 'utf8');
  assert.match(xml, /#ifdef CASTLETEK_WLED_COMPAT\s+castleTekWLEDPrintHardware\(settingsScript\);\s+\/\/[^\n]+\s+if \(strcmp\(releaseString, "CastleTek_WLED_Compat_DigQuad_v2v3"\) == 0\) \{\s+settingsScript\.print\(F\("d\.ct_led_type_picker=1;"\)\);\s+\}\s+#endif/);
  assert.match(read('settings_leds.htm'), /delete d\.ct_led_type_picker;/);
});


test('Dig-Quad templates preserve current retired types but reject switching to omitted choices before draft mutation', () => {
  for (const type of [24,27]) {
    const result = digQuadPickerContext(type), {ctx, names, document} = result;
    document.ct_led_pins = [16];
    const row = {type, pin:[16], enabled:true, len:10};
    result.refresh();
    assert.equal(ctx.ctTemplatePinsOK({hw:{led:{ins:[row]}}}),true);
    names.LT0.value = '30';
    result.refresh();
    const before = successfulRowFields(names);
    assert.equal(ctx.ctTemplatePinsOK({hw:{led:{ins:[row]}}}),false);
    assert.deepEqual(successfulRowFields(names),before);
  }
});
