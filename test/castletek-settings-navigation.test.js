const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const common = fs.readFileSync(path.join(root, 'wled00/data/common.js'), 'utf8');
const menu = fs.readFileSync(path.join(root, 'wled00/data/settings.htm'), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function page(pathname, readyState = 'complete') {
  const assets = [], metadata = [], navigation = [], listeners = [];
  const nodes = Object.fromEntries(['2dbtn', 'uibtn', 'umbtn', 'pinsbtn', 'secbtn', 'timebtn'].map(id => [id, {
    removed:false, textContent:'', remove() { this.removed = true; }
  }]));
  const document = {
    title:'WLED Settings', readyState,
    documentElement:{style:{visibility:'hidden'}},
    head:{appendChild:asset => assets.push(asset)},
    createElement:tag => ({tag}),
    getElementById:id => nodes[id],
    querySelectorAll:selector => { assert.equal(selector, '.helpB'); return []; },
    addEventListener:(event, listener) => { assert.equal(event, 'DOMContentLoaded'); listeners.push(listener); }
  };
  const window = {location:{pathname, protocol:'http:', host:'controller.test', hostname:'controller.test', port:''},
    open:(...args) => navigation.push(args)};
  const ctx = vm.createContext({document, window, console});
  vm.runInContext(menu.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);
  const commonAsset = assets[0];
  assert.equal(commonAsset.src, 'common.js');
  vm.runInContext(common, ctx);
  ctx.loadJS = url => metadata.push(url);
  commonAsset.onload();
  return {ctx,document,assets,metadata,navigation,nodes,
    domReady() { document.readyState = 'interactive'; listeners.forEach(listener => listener()); }};
}

test('settings menu is hidden in its initial HTML before any external script can load', () => {
  assert.match(menu, /html\s*\{[^}]*visibility:\s*hidden;[^}]*background:\s*#000;/);
  assert.ok(menu.indexOf('visibility: hidden') < menu.indexOf('<body>'));
});

test('settings menu waits for both branding assets in either load order and only loads them once', async () => {
  for (const readyState of ['loading','complete']) for (const first of ['link','script']) {
    const p = page('/proxy/castletek/v1/settings', readyState);
    assert.equal(p.document.documentElement.style.visibility, 'hidden');
    if (readyState === 'loading') p.domReady();
    const branding = p.assets.slice(1);
    assert.equal(branding.length, 2);
    assert.equal(branding[0].href, '/proxy/castletek/v1/castletek-branding.css');
    assert.equal(branding[1].src, '/proxy/castletek/v1/castletek-branding.js');
    assert.equal(p.ctx.castleTekLoadBranding(), p.ctx.castleTekLoadBranding());
    assert.equal(p.assets.length, 3, 'auto-load and menu initialization share one request per asset');
    assert.equal(p.document.title, 'CastleTek Controller Settings');
    for (const id of ['2dbtn','uibtn','umbtn','pinsbtn']) assert.equal(p.nodes[id].removed, true);
    assert.equal(p.nodes.secbtn.textContent, 'Security & Maintenance');
    assert.equal(p.nodes.timebtn.textContent, 'Date & Time');
    branding.find(asset => asset.tag === first).onload();
    await settle();
    assert.equal(p.document.documentElement.style.visibility, 'hidden');
    branding.find(asset => asset.tag !== first).onload();
    await settle();
    assert.equal(p.document.documentElement.style.visibility, 'visible');
    assert.deepEqual(p.metadata, ['http://controller.test/proxy/castletek/v1/settings/s.js?p=0']);
  }
});

test('an explicit branding failure does not leave the menu blank forever', async () => {
  for (const failed of ['link','script']) {
    const p = page('/castletek/v1/settings');
    p.assets.slice(1).find(asset => asset.tag === failed).onerror();
    await settle();
    assert.equal(p.document.documentElement.style.visibility, 'hidden');
    p.assets.slice(1).find(asset => asset.tag !== failed).onload();
    await settle();
    assert.equal(p.document.documentElement.style.visibility, 'visible');
  }
});

test('stock and authenticated namespaces keep their menu behavior without CastleTek assets', async () => {
  for (const pathname of ['/settings', '/api/castletek/v1/settings', '/proxy/api/castletek/v1/settings']) {
    const p = page(pathname);
    await settle();
    assert.equal(p.assets.length, 1);
    assert.equal(p.document.documentElement.style.visibility, 'visible');
    assert.equal(p.document.title, 'WLED Settings');
    assert.equal(p.nodes.pinsbtn.removed, false);
    assert.equal(p.nodes.timebtn.textContent, '');
  }
});

test('Back from a settings form remains navigation only, regardless of unsaved form values', () => {
  for (const dirty of [false,true]) {
    const navigation = [];
    const document = {Sf:{draft:dirty ? 'edited' : 'saved'}};
    const window = {location:{pathname:'/proxy/castletek/v1/settings/leds', protocol:'http:', host:'controller.test', hostname:'controller.test', port:''}, open:(...args) => navigation.push(args)};
    const ctx = vm.createContext({document,window});
    vm.runInContext(common,ctx);
    ctx.getLoc(); ctx.B();
    assert.deepEqual(navigation, [['http://controller.test/proxy/castletek/v1/settings','_self']]);
    assert.equal(document.Sf.draft, dirty ? 'edited' : 'saved');
  }
});
