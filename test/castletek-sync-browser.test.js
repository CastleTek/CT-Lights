const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Run the actual browser handlers against controls grouped from the shipped markup.
function page(pathname = '/castletek/v1/settings/sync', file = 'settings_sync.htm') {
  const names = {}, ids = {}, alerts = [];
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.style = {};
      this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.textContent = '';
    }
    set name(value) { if (this._name && names[this._name] === this) delete names[this._name]; this._name = value; names[value] = this; }
    get name() { return this._name; }
    setAttribute(name, value) { this[name] = value; }
    get childElementCount() { return this.children.length; }
    set innerHTML(value) { assert.equal(value, ''); this.replaceChildren(); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    appendChild(child) { this.append(child); return child; }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
      for (const element of [this, ...this.querySelectorAll('input, select, button')]) {
        if (element.name && names[element.name] === element) delete names[element.name];
      }
    }
    querySelectorAll(selector) {
      const numeric = selector === 'input[type="number"]';
      const tags = numeric ? ['INPUT'] : selector.split(',').map(tag => tag.trim().toUpperCase());
      return this.children.flatMap(child => [...(tags.includes(child.tagName) && (!numeric || child.type === 'number') ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    focus() { this.focused = true; }
  }
  const html = read('wled00/data/' + file);
  const document = {Sf: names, head: new Element('head'), createElement: tag => new Element(tag), getElementById: id => ids[id],
    querySelectorAll(selector) { const [id, tag] = selector.split(' '); return ids[id.slice(1)].querySelectorAll(tag); }};
  const body = new Element('body'), stack = [body];
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const match of markup.matchAll(/<\/?([a-z][a-z\d]*)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      const index = stack.findLastIndex(element => element.tagName === tag.toUpperCase());
      if (index > 0) stack.splice(index);
      continue;
    }
    const element = new Element(tag);
    for (const attribute of match[2].matchAll(/([a-z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi)) {
      const name = attribute[1], value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (['hidden', 'disabled', 'checked', 'required'].includes(name)) element[name] = true;
      else if (['name', 'type', 'value', 'id'].includes(name)) element[name] = value;
    }
    if (element.id) ids[element.id] = element;
    stack.at(-1).append(element);
    if (!['input', 'br', 'hr', 'meta', 'link'].includes(tag)) stack.push(element);
  }
  const ctx = vm.createContext({document, window: {location: {pathname, protocol:'http:', host:'controller.test', hostname:'controller.test', port:''}}, alert: message => alerts.push(message), setTimeout() {}});
  vm.runInContext(read('wled00/data/common.js'), ctx);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  ctx.getLoc();
  return {ctx, document, names, ids, alerts};
}

function metadata(overrides = {}) {
  return {schema:3, wifiConnected:true, offlineChannel:1, maxSenders:10, transport:'lan', espNowAvailable:true, activeMac:'aabbcc112234', mac:'aabbcc112234', apMac:'aabbcc112236', channel:6, radioState:2, ...overrides};
}
function loaded(p, senders = ['aabbccddeef0'], overrides = {}) {
  p.ctx.ctPrepareSync();
  p.document.ctSync = metadata(overrides);
  p.ctx.ctSyncSenders(senders);
  p.ctx.ctFinishSync();
}

const removedSections = ['buttonSyncChanges', 'alexaSyncChanges', 'hueSyncChanges', 'networkDMX', 'dmxInput', 'dmxInputOff', 'dmxOnOffOutput', 'externalSyncWarning', 'mqttSettings', 'hueSettings', 'alexaSettings', 'serialSettings'];
const removedControls = ['SB', 'SA', 'SH', 'DI', 'EP', 'EU', 'EM', 'ES', 'DA', 'XX', 'PY', 'DM', 'IDMR', 'IDMT', 'IDME', 'IDMP', 'MQ', 'MS', 'MQPORT', 'MQUSER', 'MQPASS', 'MQCID', 'MD', 'MG', 'BM', 'RT', 'HP', 'HL', 'HI', 'HO', 'HB', 'HC', 'H0', 'H1', 'H2', 'H3', 'AL', 'AI', 'AP', 'BD'];
const retainedControls = [ 'UP', 'U2', 'RB', 'RC', 'RX', 'RP', 'SO', 'SG', 'SS', 'SD', 'UR', 'NL', 'NB', 'RD', 'MO', 'RLM', 'ET', 'FB', 'RG', 'WO'];

test('Compatibility removes retired integration controls without disabling ordinary sync or realtime fields', () => {
  const p = page('/proxy/castletek/v1/settings/sync');
  p.ctx.ctPrepareSync();
  for (const id of removedSections) assert.equal(p.ids[id].hidden, true, id);
  for (const name of removedControls) assert.equal(p.names[name].disabled, true, name);
  for (const name of retainedControls) assert.equal(p.names[name].disabled, false, name);
  assert.equal(p.ctx.GC(), false, 'must not submit a partial form before metadata');
  assert.equal(p.ids.ctSyncRadio.hidden, false);
  assert.equal(p.ids.stockESPNowMode.hidden, true);
  assert.equal(p.names.EN.disabled, true);
  assert.equal(p.names.CTST.disabled, true);
  assert.equal(p.names.CTOC.disabled, true);
  assert.equal(p.names.CTST.value, '', 'never guess a transport while metadata is missing');
  assert.equal(p.ids.syncUDPHeading.textContent, 'UDP interfaces');
  assert.equal(p.ids.syncRetransmissionsLabel.textContent, 'Sync retransmissions:');
  assert.equal(p.ids.syncRestartNotice.textContent, 'UDP port changes require a restart.');
  assert.match(read('wled00/data/settings_sync.htm'), /<label>Sync method:/);
});

test('stock WLED retains its integrations and native form submission', () => {
  const p = page('/settings/sync');
  p.ctx.ctPrepareSync();
  for (const id of removedSections) assert.equal(p.ids[id].hidden, false, id);
  for (const name of [...removedControls, ...retainedControls]) assert.equal(p.names[name].disabled, false, name);
  assert.equal(p.names.EN.disabled, false);
  assert.equal(p.ids.stockESPNowMode.hidden, false);
  assert.equal(p.ids.syncRestartNotice.textContent, '', 'Compatibility copy is not applied to stock WLED');
  assert.match(read('wled00/data/settings_sync.htm'), /id="syncRestartNotice" class="warn">Reboot required to apply changes\./);
  assert.equal(p.names.CTST.disabled, true);
  assert.equal(p.names.CTOC.disabled, true);
  assert.equal(p.names.RE.disabled, true);
  assert.equal(p.names.RPO.disabled, true);
  assert.equal(p.names.CTSYNC.disabled, true);
  assert.equal(p.ids.ctSyncRadio.hidden, true);
  assert.equal(p.ctx.GC(), true);
});

test('schema-3 LAN metadata enables the manual transport form while preserving other loaded fields', () => {
  const p = page(); loaded(p);
  assert.equal(p.names.RE.disabled, true);
  assert.equal(p.names.RE.checked, false);
  assert.equal(p.names.RPO.disabled, false);
  assert.equal(p.names.CTSYNC.disabled, false);
  assert.equal(p.names.CTSYNC.value, '3');
  assert.equal(p.names.CTOC.value, '1');
  assert.equal(p.names.CTOC.disabled, false, 'preserve the complete native form on LAN');
  assert.equal(p.ids.ctSyncOfflineChannel.hidden, true);
  assert.equal(p.names.CTST.disabled, false);
  assert.equal(p.names.CTST.value, 'lan');
  assert.equal(p.names.EN.disabled, true);
  assert.match(p.ids.ctSyncModeHelp.textContent, /same LAN.*Internet access is not required/);
  assert.equal(p.ids.ctSyncControls.hidden, false);
  assert.equal(p.ids.ESPNOW.style.display, 'block');
  assert.equal(p.ids.NoESPNOW.style.display, 'none');
  assert.match(p.ids.ctSyncAddress.textContent, /AA:BB:CC:11:22:34.*channel: 6/);
  p.names.GS.value = '129'; p.names.GR.value = '66'; p.ctx.FC();
  p.names.RPO.checked = true; p.names.RB.checked = true; p.names.RX.checked = true;
  p.names.UP.value = '21324'; p.names.U2.value = '65506'; p.names.UR.value = '2';
  assert.equal(p.ctx.GC(), true);
  assert.equal(p.names.GS.value, 129); assert.equal(p.names.GR.value, 66);
  assert.equal(p.names.RB.checked, true); assert.equal(p.names.RX.checked, true);
  assert.equal(p.names.RB.disabled, false); assert.equal(p.names.RX.disabled, false);
  assert.equal(p.names.UP.value, '21324'); assert.equal(p.names.U2.value, '65506'); assert.equal(p.names.UR.value, '2');
});

test('sender editing normalizes MACs and preserves remaining linked senders after removal', () => {
  const p = page(); loaded(p, ['aabbccddeef0', '102030405060']);
  p.names.RM0.value = ' AA:BB:CC:DD:EE:F0 ';
  assert.equal(p.ctx.ctValidateSync(), true);
  assert.equal(p.names.RM0.value, 'aabbccddeef0');
  p.ids.ctSyncSenders.children[0].querySelector('button').onclick();
  assert.equal(p.names.RM0.value, '102030405060');
  assert.equal(p.names.RM1, undefined);
  p.ctx.ctAddSyncSender('22-33-44-55-66-77');
  assert.equal(p.ctx.ctValidateSync(), true);
  assert.equal(p.names.RM1.value, '223344556677');
});

test('invalid, multicast, empty-zero and duplicate sender addresses cannot be submitted', () => {
  for (const mac of ['invalid', 'AA:BB:CC:DD:EE', '000000000000', 'ffffffffffff', '010000000000']) {
    const p = page(); loaded(p); p.names.RM0.value = mac;
    assert.equal(p.ctx.ctValidateSync(), false, mac);
    assert.equal(p.names.RM0.focused, true);
  }
  const p = page(); loaded(p); p.ctx.ctAddSyncSender('AA-BB-CC-DD-EE-F0');
  assert.equal(p.ctx.ctValidateSync(), false);
});

test('sender capacity stays within firmware limits and an empty list is a valid explicit clear', () => {
  const p = page(); loaded(p, []);
  assert.equal(p.ctx.ctValidateSync(), true);
  for (let i = 1; i < 12; i++) p.ctx.ctAddSyncSender(`0200000000${i.toString(16).padStart(2, '0')}`);
  assert.equal(p.ids.ctSyncSenders.children.length, 10);
  assert.equal(p.ids.ctAddSender.disabled, true);
  assert.equal(p.names.RM10, undefined);
});

test('missing, legacy or unsupported metadata fails closed without choosing a fallback', () => {
  for (const change of [
    p => delete p.document.ctSync,
    p => p.document.ctSync.schema = 1,
    p => p.document.ctSync.schema = 2,
    p => p.document.ctSync.schema = 4,
    p => delete p.document.ctSync.wifiConnected,
    p => p.document.ctSync.wifiConnected = 1,
    p => delete p.document.ctSync.offlineChannel,
    p => p.document.ctSync.offlineChannel = '1',
    p => p.document.ctSync.offlineChannel = true,
    p => p.document.ctSync.offlineChannel = 0,
    p => p.document.ctSync.offlineChannel = 12,
    p => p.document.ctSync.offlineChannel = 1.5,
    p => p.document.ctSync.maxSenders = 11,
    p => p.document.ctSync.channel = 15,
    p => p.document.ctSync.radioState = 3,
    p => p.document.ctSync.activeMac = 'bad',
    p => delete p.document.ctSync.mac,
    p => delete p.document.ctSync.transport,
    p => p.document.ctSync.transport = 'automatic',
    p => p.document.ctSync.transport = 'LAN',
    p => p.document.ctSync.transport = null,
    p => delete p.document.ctSync.espNowAvailable,
    p => p.document.ctSync.espNowAvailable = 1
  ]) {
    const p = page(); p.ctx.ctPrepareSync(); p.document.ctSync = metadata();
    p.ctx.ctSyncSenders(['aabbccddeef0']); change(p); p.ctx.ctFinishSync();
    assert.equal(p.ctx.GC(), false);
    for (const name of ['RE', 'RPO', 'CTSYNC', 'CTST', 'CTOC']) assert.equal(p.names[name].disabled, true, name);
    assert.equal(p.names.CTST.value, '');
  }
  const p = page(); p.document.ctSync = metadata();
  p.ctx.ctFinishSync(); assert.equal(p.ctx.GC(), false);
});

test('ESP-NOW transport remains explicit and saving with radio off does not enable it or select LAN', () => {
  const p = page(); loaded(p, [], {transport:'espnow'});
  assert.equal(p.names.CTST.value, 'espnow');
  assert.match(p.ids.ctSyncModeHelp.textContent, /same radio channel.*do not align.*radio off, sync is disabled/);
  p.names.RE.checked = false; p.names.EN.checked = false;
  assert.equal(p.ctx.GC(), true);
  assert.equal(p.names.CTST.value, 'espnow'); assert.equal(p.names.RE.checked, false);
  assert.equal(p.names.EN.checked, false); assert.equal(p.names.EN.disabled, true);
  p.names.CTST.value = 'lan'; p.ctx.ctSyncModeChanged();
  assert.equal(p.names.RE.checked, false); assert.equal(p.ctx.GC(), true);
  assert.match(p.ids.ctSyncModeHelp.textContent, /local network.*same LAN/);
  p.names.RE.checked = true; p.names.CTST.value = 'espnow'; p.ctx.ctSyncModeChanged();
  assert.equal(p.names.RE.checked, true); assert.equal(p.ctx.GC(), true);
});

test('unsupported or missing selector values cannot be submitted, including an unavailable ESP-NOW option', () => {
  for (const value of ['', 'automatic', 'LAN', 'invalid']) {
    const p = page(); loaded(p); p.names.CTST.value = value;
    assert.equal(p.ctx.GC(), false, value); assert.equal(p.names.CTST.focused, true);
  }
  const p = page(); loaded(p, [], {espNowAvailable:false});
  assert.equal(p.names.CTST.value, 'lan'); assert.equal(p.names.RE.disabled, true);
  assert.equal(p.ids.ctESPNowTransport.disabled, true); assert.equal(p.ctx.GC(), true);
  assert.match(p.ids.ctSyncStatus.textContent, /CT-SYNC is unavailable/);
  p.names.CTST.value = 'espnow';
  assert.equal(p.ctx.GC(), false); assert.equal(p.names.CTST.value, 'espnow', 'never fall back automatically');
  const stored = page(); loaded(stored, [], {transport:'espnow', espNowAvailable:false});
  assert.equal(stored.names.CTST.disabled, false, 'allow repair by an explicit selection');
  assert.equal(stored.names.CTST.value, 'espnow'); assert.equal(stored.ctx.GC(), false);
  stored.names.CTST.value = 'lan'; stored.ctx.ctSyncModeChanged();
  assert.equal(stored.ctx.GC(), true); assert.equal(stored.names.CTST.value, 'lan');
});

test('an invalid reload disables the new form marker and controls after an earlier valid load', () => {
  const p = page(); loaded(p);
  delete p.document.ctSync.transport; p.ctx.ctFinishSync();
  assert.equal(p.ctx.GC(), false);
  for (const name of ['RE', 'RPO', 'CTSYNC', 'CTST', 'CTOC']) assert.equal(p.names[name].disabled, true, name);
  assert.equal(p.ids.ctSyncControls.hidden, true);
});


test('LAN disables a loaded radio and switching back to CT-SYNC requires an explicit radio choice', () => {
  const p = page(); p.names.RE.checked = true; loaded(p);
  assert.equal(p.names.RE.checked, false); assert.equal(p.names.RE.disabled, true);
  p.names.CTST.value = 'espnow'; p.ctx.ctSyncModeChanged();
  assert.equal(p.names.RE.disabled, false); assert.equal(p.names.RE.checked, false);
  p.names.RE.checked = true; assert.equal(p.ctx.GC(), true); assert.equal(p.names.RE.checked, true);
  p.names.CTST.value = 'lan'; p.ctx.ctSyncModeChanged();
  assert.equal(p.names.RE.checked, false); assert.equal(p.names.RE.disabled, true);
  p.names.RE.checked = true; assert.equal(p.ctx.GC(), true);
  assert.equal(p.names.RE.checked, false, 'submission also enforces LAN radio off');
});

test('offline channel is editable while connected without changing the actual router channel', () => {
  const p = page(); loaded(p, [], {transport:'espnow', channel:6, offlineChannel:11});
  assert.equal(p.ids.ctSyncOfflineChannel.hidden, false);
  assert.equal(p.names.CTOC.disabled, false); assert.equal(p.names.CTOC.value, '11');
  assert.match(p.ids.ctSyncChannelHelp.textContent, /Connected Wi-Fi controls.*does not change the router channel/);
  assert.match(p.ids.ctSyncAddress.textContent, /Actual radio channel: 6/);
  p.names.CTOC.value = '1'; assert.equal(p.ctx.GC(), true);
  assert.equal(p.document.ctSync.channel, 6); assert.equal(p.document.ctSync.offlineChannel, 11);
  assert.match(p.ids.ctSyncAddress.textContent, /Actual radio channel: 6/);
  const offline = page(); loaded(offline, [], {transport:'espnow', wifiConnected:false, channel:11, offlineChannel:11});
  assert.match(offline.ids.ctSyncChannelHelp.textContent, /Wi-Fi is disconnected.*connection attempt fails/);
  assert.match(offline.ids.ctSyncAddress.textContent, /Actual radio channel: 11/);
  assert.equal(offline.ctx.GC(), true);
});

test('offline channel accepts only complete integers from 1 through 11 before form submission', () => {
  for (const value of ['', '0', '12', '1.5', '1x', '01', ' 1', '-1']) {
    const p = page(); loaded(p, [], {transport:'espnow'}); p.names.CTOC.value = value;
    assert.equal(p.ctx.GC(), false, value); assert.equal(p.names.CTOC.focused, true, value);
  }
  for (const value of ['1', '6', '11']) {
    const p = page(); loaded(p, [], {transport:'espnow'}); p.names.CTOC.value = value;
    assert.equal(p.ctx.GC(), true, value); assert.equal(p.names.CTOC.value, value);
  }
});

test('Compatibility WiFi hides and disables radio controls including senders added by metadata later', () => {
  const p = page('/castletek/v1/settings/wifi', 'settings_wifi.htm');
  p.ctx.loadJS = () => {}; p.ctx.S();
  assert.equal(p.ids.ct_wifi_radio.hidden, true); assert.equal(p.names.RE.disabled, true);
  assert.equal(p.ids['+'].disabled, true);
  p.ctx.aR('RM0', 'aabbccddeef0'); p.ctx.aR('RM1', '102030405060');
  for (const name of ['RE', 'RM0', 'RM1']) assert.equal(p.names[name].disabled, true, name);
  assert.equal(p.ids.rml.querySelectorAll('button').every(button => button.disabled), true);
  p.names.RE.checked = true; p.ctx.tE();
  assert.equal(p.ids.ct_wifi_radio.hidden, true);
  assert.equal(p.names.ETH.disabled, false); assert.equal(p.names.TX.disabled, false);
  p.ctx.rstR(); p.ctx.aR('RM0', '223344556678');
  assert.equal(p.names.RM0.disabled, true);
});

test('stock WiFi retains the radio section and dynamic sender controls', () => {
  const p = page('/settings/wifi', 'settings_wifi.htm');
  p.ctx.loadJS = () => {}; p.ctx.S();
  assert.equal(p.ids.ct_wifi_radio.hidden, false); assert.equal(p.names.RE.disabled, false);
  p.ctx.aR('RM0', 'aabbccddeef0');
  assert.equal(p.names.RM0.disabled, false); assert.equal(p.ids['+'].disabled, false);
  p.names.RE.checked = true; p.ctx.tE(); assert.equal(p.ids.rlc.style.display, 'block');
  p.names.RE.checked = false; p.ctx.tE(); assert.equal(p.ids.rlc.style.display, 'none');
});

test('Time presentation removes retired sections but preserves their complete-form values', () => {
  for (const pathname of ['/castletek/v1/settings/time', '/settings/time', '/api/castletek/v1/settings/time']) {
    const p = page(pathname, 'settings_time.htm');
    const values = {O1:'5', O2:'4000', OM:'30', CY:'26', CI:'9', CD:'20', CH:'18', CM:'30', CS:'0', MC:'42', A0:'3', A1:'4', MN:'7'};
    const checkboxes = {OL:true, O5:false, OS:true, OB:false, CE:true};
    for (const [name, value] of Object.entries(values)) p.names[name].value = value;
    for (const [name, value] of Object.entries(checkboxes)) p.names[name].checked = value;
    p.ctx.ctPrepareTime();
    const compat = pathname.startsWith('/castletek/');
    for (const id of ['clockSettings', 'macroPresetInfo', 'countdownPresetSettings', 'alexaPresetSettings']) assert.equal(p.ids[id].hidden, compat);
    assert.equal(p.ids.presetAssignments.hidden, compat);
    for (const [name, value] of Object.entries(values)) {
      assert.equal(p.names[name].value, value, name);
      assert.equal(p.names[name].disabled, false, name);
      assert.equal(p.names[name].type, compat ? 'hidden' : 'number', name);
    }
    for (const [name, value] of Object.entries(checkboxes)) {
      assert.equal(p.names[name].checked, value, name);
      assert.equal(p.names[name].disabled, false, name);
      assert.equal(p.names[name].type, 'checkbox', name);
    }
    assert.equal(p.names.MN.disabled, false);
    if (compat) {
      assert.equal(p.document.title, 'Date & Time');
      assert.equal(p.ids.timeSettingsHeading.textContent, 'Date & Time');
    }
  }
});
