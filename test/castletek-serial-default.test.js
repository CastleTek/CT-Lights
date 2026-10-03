const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('production serial load and save paths fix Compatibility at 115200 and retain stock rates', () => {
  const cfg = read('wled00/cfg.cpp'), set = read('wled00/set.cpp');
  const loadStart = cfg.indexOf('  CJSON(serialBaud, hw[F("baud")]);');
  const loadEnd = cfg.indexOf('  updateBaudRate(serialBaud *100);', loadStart) + '  updateBaudRate(serialBaud *100);'.length;
  const saveStart = set.indexOf('    #ifdef CASTLETEK_WLED_COMPAT\n    serialBaud = 1152;');
  const saveEnd = set.indexOf('    updateBaudRate(serialBaud *100);', saveStart) + '    updateBaudRate(serialBaud *100);'.length;
  assert.ok(loadStart >= 0 && saveStart >= 0);
  const notification = set.match(/    #ifndef CASTLETEK_WLED_COMPAT\n    notifyAlexa = request->hasArg\(F\("SA"\)\);\n    #endif[^\n]*/)[0];
  const source = `
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <map>
#include <string>
#include "src/dependencies/json/ArduinoJson-v6.h"
#define F(x) x
${cfg.match(/^#define CJSON.*$/m)[0]}
struct String : std::string { using std::string::string; int toInt() const { return std::atoi(c_str()); } };
struct Request { std::map<std::string,String> fields; String arg(const char* key) { return fields[key]; } bool hasArg(const char* key) { return fields.count(key); } };
bool notifyAlexa = false;
void saveNotification(Request* request) {
${notification}
}
uint16_t serialBaud = 1152;
int configuredBaud = 0;
void updateBaudRate(int rate) { configuredBaud = rate; }
bool load(JsonObject hw, bool fromFS) {
  bool needsSave = false;
${cfg.slice(loadStart, loadEnd)}
  return needsSave;
}
void save(Request* request) {
  int t;
${set.slice(saveStart, saveEnd)}
}
int main() {
  for (bool installed : {false,true}) for (bool submitted : {false,true}) {
    notifyAlexa = installed; Request req; if (submitted) req.fields["SA"] = "on";
    saveNotification(&req);
#ifdef CASTLETEK_WLED_COMPAT
    assert(notifyAlexa == installed);
#else
    assert(notifyAlexa == submitted);
#endif
  }
  for (int rate : {96, 1152, 2304, 15000, 1, 15001}) {
    DynamicJsonDocument doc(128); doc["baud"] = rate;
    serialBaud = 1152;
    bool migrated = load(doc.as<JsonObject>(), true);
#ifdef CASTLETEK_WLED_COMPAT
    assert(serialBaud == 1152 && configuredBaud == 115200 && migrated == (rate != 1152));
    doc["baud"] = serialBaud;
    assert(!load(doc.as<JsonObject>(), true)); // migration is not repeated
    doc["baud"] = rate;
    assert(!load(doc.as<JsonObject>(), false)); // non-boot calls do not schedule boot repair
#else
    const int expected = rate >= 96 && rate <= 15000 ? rate : 1152;
    assert(serialBaud == expected && configuredBaud == expected * 100 && !migrated);
#endif
  }
  for (const char* rate : {"1152", "2304", "15000", ""}) {
    serialBaud = 1152; Request req; if (*rate) req.fields["BD"] = rate;
    save(&req);
#ifdef CASTLETEK_WLED_COMPAT
    assert(serialBaud == 1152 && configuredBaud == 115200);
#else
    const int expected = *rate ? std::atoi(rate) : 1152;
    assert(serialBaud == expected && configuredBaud == expected * 100);
#endif
  }
}
`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-serial-default-'));
  try {
    const file = path.join(temp, 'serial.cpp'), binary = path.join(temp, 'serial');
    fs.writeFileSync(file, source);
    for (const flags of [[], ['-DCASTLETEK_WLED_COMPAT']]) {
      const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++17', ...flags, '-I', path.join(root, 'wled00'), file, '-o', binary], {encoding:'utf8', timeout:60000});
      assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
      const ran = spawnSync(binary, [], {encoding:'utf8', timeout:10000});
      assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    }
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
});
