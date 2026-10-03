const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const between = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `missing production block: ${start}`);
  return source.slice(a, b);
};
test('actual schedule parser, calendar, event engine, form preflight and persistent save behavior', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-schedules-'));
  try {
    const module = read('wled00/castletek_wled_schedules.cpp').replace('#include "wled.h"', '');
    assert.doesNotMatch(module, /\.(?:is|as)<(?:u?int64_t|long long)>/, 'embedded JSON conversions must remain 32-bit');
    const writer = between(read('wled00/cfg.cpp'), 'void serializeConfigToFS()', '\nvoid serializeConfig(JsonObject root)');
    const guards = between(read('wled00/set.cpp'), '  #ifdef CASTLETEK_WLED_COMPAT\n  if (!castleTekWLEDValidateSettings', '  //WIFI SETTINGS');
    const source = read('test/fixtures/castletek-schedules-host.h') + '\n' + module + '\n' + writer + `
static bool castleTekWLEDValidateSettings(AsyncWebServerRequest* request, byte) { return castleTekWLEDValidateScheduleSettings(request); }
static unsigned unrelatedFormWrites = 0;
static bool hostTimeForm(AsyncWebServerRequest* request) {
  const byte subPage = 5;
  #define SUBPAGE_TIME 5
  #define SUBPAGE_SYNC 4
  #define SUBPAGE_WIFI 1
  #define SUBPAGE_SEC 6
${guards}
  ++unrelatedFormWrites;
  configNeedsWrite = true;
  if (castleTekSettingsLocked) releaseJSONBufferLock();
  return true;
}
` + read('test/fixtures/castletek-schedules-host.cpp');
    fs.writeFileSync(path.join(temp, 'schedules.cpp'), source);
    const binary = path.join(temp, 'schedules');
    const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-DARDUINOJSON_USE_LONG_LONG=0', '-I', path.join(root, 'wled00'), path.join(temp, 'schedules.cpp'), '-o', binary], {encoding: 'utf8', timeout: 60000});
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const result = spawnSync(binary, [], {encoding: 'utf8', timeout: 15000});
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.match(result.stdout, /Schedule checks passed: \d+/);
    process.stdout.write(result.stdout);
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
test('Compatibility validation precedes unrelated config/form writes and includes restore uploads', () => {
  const cfg = read('wled00/cfg.cpp'), set = read('wled00/set.cpp'), server = read('wled00/wled_server.cpp');
  assert.ok(cfg.indexOf('castleTekWLEDLoadScheduleConfig(doc, fromFS)') < cfg.indexOf('JsonObject id = doc["id"]'));
  assert.ok(set.indexOf('castleTekWLEDApplyScheduleSettings(request)') < set.indexOf('//WIFI SETTINGS'));
  assert.match(read('wled00/castletek_wled_hardware.cpp'), /!castleTekWLEDValidateScheduleConfig\(doc\)/);
  assert.match(read('wled00/castletek_wled_hardware.cpp'), /SUBPAGE_TIME && !castleTekWLEDValidateScheduleSettings\(request\)/);
  assert.match(server, /castleTekWLEDValidateRestore\(pDoc->as<JsonObject>\(\)\)/);
  assert.match(server, /bool applied = handleSettingsSet\(request, subPage\);[\s\S]*?!applied && subPage == SUBPAGE_TIME[\s\S]*?serveMessage\(request, 409/);
  assert.match(server, /lowercase\.startsWith\(F\("\/\.ct-upload-"\)\)/);
  assert.match(cfg, /const char\* temporary = "\/\.ct-upload-schedules-cfg"/);
});
test('managed schedule dispatch follows legacy timers and stays Compatibility-only', () => {
  const timer = between(read('wled00/ntp.cpp'), 'void checkTimers()', '#define ZENITH');
  assert.ok(timer.indexOf('applyPreset(t.preset)') < timer.indexOf('castleTekWLEDCheckSchedules()'));
  assert.match(timer, /#ifdef CASTLETEK_WLED_COMPAT\s+castleTekWLEDCheckSchedules\(\);\s+#endif/);
  assert.match(read('wled00/castletek_wled_schedules.cpp'), /#ifdef CASTLETEK_WLED_COMPAT/);
  assert.match(read('wled00/xml.cpp'), /#ifdef CASTLETEK_WLED_COMPAT\s+castleTekWLEDPrintSchedules\(settingsScript\);/);
  assert.match(read('wled00/json.cpp'), /castleTekWLEDSerializeSchedules\(castleTek\);/);
});
