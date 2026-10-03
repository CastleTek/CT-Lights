const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing production block: ${startMarker}`);
  return source.slice(start, end);
}

for (const compatibility of [true, false]) {
  test(`boot saves accumulated config migrations after usermod loading in ${compatibility ? 'Compatibility' : 'stock WLED'}`, () => {
    const config = fs.readFileSync(path.join(root, 'wled00/cfg.cpp'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'wled00/wled.cpp'), 'utf8');
    const initialDecision = between(config, '  bool needsSave = false;', '  //int rev_major');
    const outputMigration = between(config, '  JsonObject hw = doc[F("hw")];', '  uint16_t total = hw_led');
    const completion = between(config, '  DEBUG_PRINTLN(F("Starting usermod config."));', '\nstatic const char s_cfg_json[]');
    const bootRead = main.split('\n').find(line => line.includes('bool needsCfgSave = deserializeConfigFromFS();'));
    const bootSave = main.split('\n').find(line => line.includes('if (needsCfgSave) serializeConfigToFS();'));
    assert.ok(bootRead && bootSave, 'missing production boot load/save decisions');
    const source = `
#include <cassert>
#include <iostream>
#include "src/dependencies/json/ArduinoJson-v6.h"
#define F(value) value
#define DEBUG_PRINTLN(...)
#define WLED_DISABLE_ESPNOW
static bool wifiDefaultsValid = true, preparationSucceeds = true;
static bool backupFailed = false, doReboot = false, doInitBusses = false;
static unsigned loads = 0, saves = 0, preparations = 0;
static bool usermodResult = true;
struct FileSystem { bool exists(const char*) { return true; } } WLED_FS;
[[maybe_unused]] static bool castleTekWLEDValidateWiFiDefaults(JsonObject) { return wifiDefaultsValid; }
[[maybe_unused]] static void castleTekWLEDApplyWiFiDefaults() {}
[[maybe_unused]] static bool castleTekWLEDOutputsNeedMigration(JsonObject led) { return !led["ct-policy"].is<int>() || led["ct-policy"].as<int>() != 2; }
// Output migration itself has independent production-policy host coverage.
// This adapter controls success; the dirty-flag decision below is production.
[[maybe_unused]] static bool castleTekWLEDPrepareLEDConfig(JsonObject, bool) { preparations++; return preparationSucceeds; }
[[maybe_unused]] static void castleTekWLEDSetBackupFailed(bool value) { backupFailed = value; }
[[maybe_unused]] static bool castleTekWLEDSyncConfigLoaded(JsonObject, bool) { return false; }
[[maybe_unused]] static void castleTekWLEDResumeWiFi() {}
namespace UsermodManager {
  static bool readFromConfig(JsonObject& value) {
    assert(!value.isNull());
    loads++;
    return usermodResult;
  }
}
static bool deserializeConfig(JsonObject doc, bool fromFS) {
  [[maybe_unused]] bool castleTekWiFiChanged = false;
${initialDecision}
${outputMigration}
  (void)hw_led;
${completion}
static DynamicJsonDocument loadedConfig(1024);
static bool deserializeConfigFromFS() { return deserializeConfig(loadedConfig.as<JsonObject>(), true); }
static void serializeConfigToFS() { saves++; }
static void boot() {
${bootRead}
${bootSave}
}
static void load(const char* json, bool usermodsOK = true, bool wifiOK = true) {
  loadedConfig.clear();
  assert(!deserializeJson(loadedConfig, json));
  loads = saves = preparations = 0;
  backupFailed = doReboot = doInitBusses = false;
  preparationSucceeds = true;
  usermodResult = usermodsOK;
  wifiDefaultsValid = wifiOK;
}
int main() {
  // Real failure observed on both boards: legacy output config and successful
  // usermod loading. A successful read must not cancel the migration write.
  load(R"({"hw":{"led":{}},"um":{}})");
  boot();
  assert(loads == 1);
#ifdef CASTLETEK_WLED_COMPAT
  assert(preparations == 1 && saves == 1);
#else
  assert(preparations == 0 && saves == 0);
#endif
  // A failed usermod read still requests a save, with or without a migration.
  load(R"({"hw":{"led":{"ct-policy":2}},"um":{}})", false);
  boot();
  assert(loads == 1 && saves == 1);
  load(R"({"hw":{"led":{}},"um":{}})", false);
  boot();
  assert(loads == 1 && saves == 1);
  // Already-current configuration must not introduce a write on every boot.
  load(R"({"hw":{"led":{"ct-policy":2}},"um":{}})");
  boot();
  assert(loads == 1 && saves == 0);
  // Wi-Fi migration was another flag the same assignment used to discard.
  load(R"({"hw":{"led":{"ct-policy":2}},"um":{}})", true, false);
  boot();
  assert(loads == 1);
#ifdef CASTLETEK_WLED_COMPAT
  assert(saves == 1);
#else
  assert(saves == 0);
#endif
  // Missing usermod settings do not change migration or clean-load decisions.
  load(R"({"hw":{"led":{}}})");
  boot();
  assert(loads == 0);
#ifdef CASTLETEK_WLED_COMPAT
  assert(saves == 1);
#else
  assert(saves == 0);
#endif
  load(R"({"hw":{"led":{"ct-policy":2}}})");
  boot();
  assert(loads == 0 && saves == 0);
#ifdef CASTLETEK_WLED_COMPAT
  // Failure before a safe output migration remains fail-closed, with no save.
  load(R"({"hw":{"led":{}},"um":{}})");
  preparationSucceeds = false;
  boot();
  assert(backupFailed && loads == 0 && saves == 0);
#endif
  // Preserve the existing config-request behavior: Compatibility skips usermod
  // reinitialization, while stock WLED still loads editable usermod settings.
  load(R"({"hw":{"led":{"ct-policy":2}},"um":{},"sv":false})", false);
  assert(!deserializeConfig(loadedConfig.as<JsonObject>(), false));
#ifdef CASTLETEK_WLED_COMPAT
  assert(loads == 0);
#else
  assert(loads == 1);
#endif
  loadedConfig["sv"] = true;
  assert(deserializeConfig(loadedConfig.as<JsonObject>(), false));
  doInitBusses = true;
  assert(!deserializeConfig(loadedConfig.as<JsonObject>(), false));
  std::cout << "config load/save decision checks passed\\n";
}
`;
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-config-save-'));
    try {
      const file = path.join(temp, 'config.cpp');
      const binary = path.join(temp, 'config');
      fs.writeFileSync(file, source);
      const flags = ['-std=c++17', '-Wall', '-Wextra', '-Werror'];
      if (compatibility) flags.push('-DCASTLETEK_WLED_COMPAT');
      const compiled = spawnSync(process.env.CXX || 'c++', [...flags, '-I', path.join(root, 'wled00'), file, '-o', binary], { encoding: 'utf8', timeout: 60000 });
      assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
      const ran = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
      assert.equal(ran.status, 0, ran.stderr || String(ran.error));
      assert.match(ran.stdout, /config load\/save decision checks passed/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}
