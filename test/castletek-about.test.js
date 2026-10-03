const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  let depth = 0, end = source.indexOf('{', start);
  do {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  } while (depth);
  return source.slice(start, end);
}

// Exercise the real metadata formatter, including the JavaScript quote escaping.
function metadataFormatter() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-about-'));
  const source = path.join(tmp, 'about.cpp');
  fs.writeFileSync(source, `
#include <cassert>
#include <cstdio>
#include <cstring>
#include <iostream>
#define PSTR(x) x
#define snprintf_P snprintf
#define VERSION 2605010
const char *versionString, *releaseString;
struct ESPClass { const char* getChipModel() { return "ESP32"; } } ESP;
${functionSource(read('wled00/xml.cpp'), 'static void fillWLEDVersion(')}
int main(int argc, char** argv) {
  assert(argc == 3);
  versionString = argv[1]; releaseString = argv[2];
  char buffer[128], small[4] = {'a', 'b', 'c', 'd'};
  fillWLEDVersion(nullptr, sizeof(buffer));
  fillWLEDVersion(small, 0); assert(small[0] == 'a');
  fillWLEDVersion(small, 3); assert(small[2] == 0 && small[3] == 'd');
  fillWLEDVersion(buffer, sizeof(buffer));
  assert(strcmp(versionString, argv[1]) == 0 && strcmp(releaseString, argv[2]) == 0);
  std::cout << buffer;
}
`);
  const binaries = new Map();
  return {
    format(compat, version, target) {
      if (!binaries.has(compat)) {
        const binary = path.join(tmp, compat ? 'compat' : 'stock');
        const flags = compat ? ['-DCASTLETEK_WLED_COMPAT'] : [];
        const result = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-DARDUINO_ARCH_ESP32', ...flags, source, '-o', binary], {encoding:'utf8', timeout:60000});
        assert.equal(result.status, 0, result.stderr || String(result.error));
        binaries.set(compat, binary);
      }
      const result = spawnSync(binaries.get(compat), [version, target], {encoding:'utf8', timeout:15000});
      assert.equal(result.status, 0, result.stderr || String(result.error));
      return result.stdout;
    },
    close() { fs.rmSync(tmp, {recursive:true, force:true}); }
  };
}

// Preserve hierarchy and text from the actual markup so moving notices is tested.
function page(pathname) {
  const ids = {};
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this._text = ''; this.hidden = false; this.open = false; this.disabled = false; this.classList = {add(){}}; }
    appendChild(child) { child.remove(); this.children.push(child); child.parent = this; return child; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    after(child) { child.remove(); this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child); child.parent = this.parent; }
    setAttribute(name, value) { this[name] = value; }
    getAttribute(name) { return this[name]; }
    set textContent(value) { this._text = value; this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]); }
  }
  const html = read('wled00/data/settings_sec.htm').replaceAll('##VERSION##', require('../package.json').version);
  const body = new Element('body'), stack = [body];
  const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const match of markup.matchAll(/<\/?([a-z][a-z\d]*)\b([^>]*)>|([^<]+)/gi)) {
    if (match[3]) { stack.at(-1)._text += match[3]; continue; }
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      const index = stack.findLastIndex(element => element.tagName === tag);
      if (index > 0) stack.splice(index);
      continue;
    }
    const element = new Element(tag);
    for (const attr of match[2].matchAll(/([a-z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi)) {
      element[attr[1]] = attr[2] ?? attr[3] ?? attr[4] ?? true;
    }
    if (element.id) ids[element.id] = element;
    stack.at(-1).appendChild(element);
    if (!['input', 'br', 'hr', 'meta', 'link'].includes(tag)) stack.push(element);
  }
  const document = {title:'Security & Update Setup', head:new Element('head'), Sf:{}, createElement:tag => new Element(tag), getElementById:id => ids[id]};
  const context = vm.createContext({document, window:{location:{pathname, protocol:'http:', host:'controller.test', hostname:'controller.test', port:''}}, setTimeout(){}});
  vm.runInContext(read('wled00/data/common.js'), context);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return {context, document, ids};
}

test('About metadata shows the DigQuad version and build without a redundant target line', () => {
  const formatter = metadataFormatter();
  try {
    assert.equal(formatter.format(true, '16.0.0', 'CastleTek_WLED_Compat_DigQuad_v2v3'), 'CT-WLED 16.0');
    assert.equal(formatter.format(true, '16.0.1', 'CastleTek_WLED_Compat_DigQuad_v2v3'), 'CT-WLED 16.0');
    assert.equal(formatter.format(true, '16.1.0+1.61', 'CastleTek_WLED_Compat_DigQuad_v2v3'), 'CT-WLED 16.1<br>Build 1.61');
    assert.equal(formatter.format(true, '16.1.1+1.62', 'CastleTek_WLED_Compat_DigQuad_v2v3'), 'CT-WLED 16.1.1<br>Build 1.62');
    assert.equal(formatter.format(true, '16.10.2', 'CastleTek_WLED_Compat_ESP32'), 'CT-WLED 16.10<br>\\"CastleTek_WLED_Compat_ESP32\\"');
    assert.equal(formatter.format(false, '16.0.0', 'DigQuad_v2v3'), 'WLED 16.0.0 (2605010)<br>\\"DigQuad_v2v3\\"<br>(Processor: ESP32)');
    // Settings metadata executes after branding; its value must remain friendly.
    const p = page('/castletek/v1/settings/sec');
    p.context.applyProductBranding();
    const formatted = formatter.format(true, '16.1.0+1.61', 'CastleTek_WLED_Compat_DigQuad_v2v3');
    vm.runInContext(`document.getElementById("installedVersion").innerHTML="${formatted}";`, p.context);
    assert.equal(p.ids.installedVersion.innerHTML, 'CT-WLED 16.1<br>Build 1.61');
  } finally { formatter.close(); }
});

test('Compatibility About keeps license and modification notice visible while retaining all credits in a closed disclosure', () => {
  const p = page('/proxy/castletek/v1/settings/sec');
  const originalCredits = p.ids.creditsNotices.textContent;
  p.context.applyProductBranding();
  assert.equal(p.ids.productDescription.textContent, 'CastleTek RGBW v1');
  assert.equal(p.ids.installedLabel.textContent, 'Installed engine:');
  assert.equal(p.ids.installedVersion.textContent, 'CT-WLED 16.0');
  const siblings = p.ids.productDescription.parent.children;
  assert.equal(siblings[siblings.indexOf(p.ids.productDescription) + 1], p.ids.installedEngine);
  assert.equal(p.ids.stockAboutSpacing.hidden, true);
  assert.equal(p.ids.modificationNotice.hidden, false);
  assert.equal(p.ids.modificationNotice.textContent, 'Based on WLED 16.0.0. Modified by CastleTek, October 2026.');
  assert.equal(p.ids.openSourceCredits.hidden, false);
  assert.equal(p.ids.openSourceCredits.open, false);
  assert.equal(p.ids.creditsNotices.parent, p.ids.openSourceCredits);
  assert.match(originalCredits, /\(c\) 2016-2024 Christian Schwinne/);
  assert.match(p.ids.openSourceCredits.textContent, /\(c\) 2016-2024 Christian Schwinne/);
  assert.match(p.ids.openSourceCredits.textContent, /Corresponding source and build configuration must accompany redistribution/);
  assert.equal(p.ids.contributorsLink.href, 'https://kno.wled.ge/about/contributors/');
  assert.equal(p.ids.firmwareSourceLink.hidden, true, 'only release metadata enables an exact-source link');
  assert.equal(p.ids.firmwareSourceLink.parent, p.ids.creditsNotices);
  assert.equal(p.ids.firmwareSourceLink.textContent, 'Download source for this version');
  const markup = read('wled00/data/settings_sec.htm');
  assert.ok(markup.indexOf('(c) 2016-2024 Christian Schwinne') < markup.indexOf('id="firmwareSourceLink"'));
  assert.equal(p.ids.licenseLink.textContent, 'EUPL v1.2-or-later license');
  assert.equal(p.ids.licenseLink.href, 'https://github.com/wled-dev/WLED/blob/v16.0.0/LICENSE');
  assert.ok(!p.ids.openSourceCredits.querySelectorAll().includes(p.ids.licenseLink), 'license stays outside the collapsed disclosure');
});

test('stock and authenticated routes retain original About presentation', () => {
  for (const pathname of ['/settings/sec', '/api/castletek/v1/settings/sec']) {
    const p = page(pathname), before = p.ids.productDescription.parent.textContent;
    const creditsParent = p.ids.creditsNotices.parent;
    p.context.applyProductBranding();
    assert.equal(p.ids.productDescription.parent.textContent, before);
    assert.equal(p.ids.creditsNotices.parent, creditsParent);
    assert.equal(p.ids.openSourceCredits.hidden, true);
    assert.equal(p.ids.modificationNotice.hidden, true);
    assert.equal(p.ids.stockAboutSpacing.hidden, false);
    assert.equal(p.ids.licenseLink.href, 'https://github.com/wled-dev/WLED/blob/main/LICENSE');
  }
});
