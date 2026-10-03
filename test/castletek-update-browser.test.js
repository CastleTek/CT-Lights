const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// Evaluate the shipped security page with controls grouped from its real markup.
// This verifies which controls are omitted from submission, not only hidden text.
function securityPage(pathname) {
  const html = read('wled00/data/settings_sec.htm');
  const ids = {}, controls = {}, opened = [];
  for (const match of html.matchAll(/id="([^"]+)"/g)) ids[match[1]] = {hidden: false, textContent: '', innerHTML: ''};
  for (const match of html.matchAll(/<input[^>]*name="([^"]+)"/g)) controls[match[1]] = {disabled: false};
  for (const [id, end] of [['securityLockSettings', '\t<div class="sec" id="OTA">'], ['OTA', '\t<div class="sec" id="backup">']]) {
    const start = html.indexOf(`id="${id}"`);
    const markup = html.slice(start, html.indexOf(end, start));
    const fields = Array.from(markup.matchAll(/<input[^>]*name="([^"]+)"/g), match => controls[match[1]]);
    ids[id].querySelectorAll = () => fields.filter(field => field !== controls.RS || !ids.factoryReset.moved);
  }
  ids.productDescription.after = engine => { assert.equal(engine, ids.installedEngine); };
  ids.openSourceCredits.appendChild = credits => { assert.equal(credits, ids.creditsNotices); };
  ids.backup.after = reset => { assert.equal(reset, ids.factoryReset); reset.moved = true; };
  ids.factoryReset.classList = {add: name => { assert.equal(name, 'sec'); }};
  const document = {
    title: 'Security & Update Setup',
    head: {appendChild() {}},
    createElement: () => ({}),
    getElementById: id => ids[id]
  };
  const ctx = vm.createContext({document, window: {
    location: {pathname, protocol: 'http:', host: 'controller.test', hostname: 'controller.test', port: ''},
    open: (...args) => opened.push(args)
  }});
  vm.runInContext(read('wled00/data/common.js'), ctx);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  ctx.getLoc();
  return {ctx, document, ids, controls, opened};
}

test('Compatibility omits security controls from submission and moves reset below backups', () => {
  const p = securityPage('/proxy/castletek/v1/settings/sec');
  p.ctx.applyProductBranding();
  assert.equal(p.document.title, 'Security & Maintenance');
  assert.equal(p.ids.securityLockSettings.hidden, true);
  assert.equal(p.ids.OTA.hidden, true);
  for (const name of ['PIN', 'OW', 'NO', 'OP', 'AO', 'SU']) assert.equal(p.controls[name].disabled, true, name);
  for (const name of ['RS', 'data', 'data2']) assert.equal(p.controls[name].disabled, false, name);
  assert.equal(p.ids.backup.hidden, false);
  assert.equal(p.ids.factoryReset.moved, true);
  p.ctx.U();
  assert.deepEqual(p.opened, []);
});

test('stock WLED retains OTA settings and its manual updater navigation', () => {
  const p = securityPage('/settings/sec');
  p.ctx.applyProductBranding();
  assert.equal(p.document.title, 'Security & Update Setup');
  assert.equal(p.ids.securityLockSettings.hidden, false);
  assert.equal(p.ids.OTA.hidden, false);
  assert.equal(p.ids.factoryReset.moved, undefined);
  for (const name of ['NO', 'OP', 'AO', 'SU', 'PIN', 'OW']) assert.equal(p.controls[name].disabled, false, name);
  p.ctx.U();
  assert.equal(p.opened.length, 1);
  assert.equal(p.opened[0][0], '/update');
});

test('the updater asset is emitted behind a Compatibility exclusion without changing other assets', async () => {
  const builder = read('tools/cdata.js');
  const updateSpec = builder.match(/file: "update\.htm",\s+name: "PAGE_update",\s+condition: "([^"]+)"/);
  assert.ok(updateSpec);
  let output;
  const ctx = vm.createContext({
    console: {info() {}}, multiHeader: '// generated\n',
    fs: {writeFileSync(_, text) { output = text; }},
    specToChunk: async (_, spec) => `const char ${spec.name}[] = "content";\n`
  });
  vm.runInContext(builder.slice(builder.indexOf('async function writeChunks('), builder.indexOf('// Check if a file is newer')), ctx);
  await ctx.writeChunks('data', [
    {name: 'PAGE_update', condition: updateSpec[1]},
    {name: 'PAGE_msg'}
  ], 'header');
  assert.match(output, /#if !defined\(CASTLETEK_WLED_COMPAT\)\nconst char PAGE_update\[\].*\n#endif\nconst char PAGE_msg\[\]/);
});

test('Pin Info is excluded from Compatibility while the existing PIN unlock page remains', () => {
  const builder = read('tools/cdata.js');
  assert.match(builder, /name: "PAGE_settings_pininfo",\s+condition: "!defined\(CASTLETEK_WLED_COMPAT\)"/);
  assert.match(read('wled00/data/settings.htm'), /gId\('pinsbtn'\)\?\.remove\(\)/);
  assert.match(read('wled00/wled_server.cpp'), /#ifndef CASTLETEK_WLED_COMPAT\s+case SUBPAGE_PINS/);
  assert.match(read('wled00/wled_server.cpp'), /case SUBPAGE_PINREQ\s*:\s*content = PAGE_settings_pin;/);
});
