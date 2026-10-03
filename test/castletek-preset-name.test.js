const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('production preset rename changes only the stored name and commits atomically without touching live lighting', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-preset-name-'));
  try {
    const production = read('wled00/castletek_preset_name.cpp').replace('#include "wled.h"\n', '');
    const support = `
bool pendingPresetSave=false;
bool presetNeedsSaving(){return pendingPresetSave;}
void closeFile(){}
std::function<void()> onYield;
void yield(){if(onYield)onYield();}
unsigned presetsModifiedTime=0,fsInfoUpdates=0;
struct {unsigned second(){return 123;}} toki;
void updateFSInfo(){++fsInfoUpdates;}
`;
    const source = read('test/fixtures/castletek-layout-host.h') + '\n' + support + '\n' + production + '\n' + read('test/fixtures/castletek-preset-name-host.cpp');
    const sourcePath = path.join(temporary, 'rename.cpp');
    const binary = path.join(temporary, 'rename');
    fs.writeFileSync(sourcePath, source);
    const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-I', path.join(root, 'wled00'), sourcePath, '-o', binary], {encoding: 'utf8', timeout: 60000});
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], {encoding: 'utf8', timeout: 15000});
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /CastleTek preset-name runtime checks passed: \d+/);
    process.stdout.write(ran.stdout);
  } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
});

test('preset-name route is registered before the generic state writer and is advertised in controller info', () => {
  const server = read('wled00/wled_server.cpp');
  const generic = server.indexOf('AsyncCallbackJsonWebHandler* handler = new AsyncCallbackJsonWebHandler(castleTekWLEDRoute(FPSTR(_json))');
  assert.ok(server.indexOf('castleTekWLEDRegisterPresetNameRoutes();') < generic);
  const guard = 'if (request->url().startsWith(castleTekWLEDRoute("/json/preset-name"))) { request->send(405); return; }';
  assert.ok(server.indexOf(guard, generic) < server.indexOf('deserializeState(root)', generic));
  assert.match(read('wled00/json.cpp'), /castleTekWLEDSerializePresetNameInfo\(castleTek\)/);
  assert.match(read('wled00/wled.cpp'), /castleTekWLEDHandlePresetName\(\)/);
  assert.match(server, /path == F\("\/presets\.json"\)\) status = castleTekWLEDInstallPresetUpload\(temporary\)/);
  assert.match(server, /const int status = castleTekWLEDDeletePresetsFile\(\)/);
  assert.match(read('wled00/set.cpp'), /castleTekWLEDPreparePresetNameFactoryReset\(\)/);
});
