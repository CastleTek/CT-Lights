const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Compatibility scan executes native configuration, status, cache, refresh, failure and timeout behavior', () => {
  const source = read('test/fixtures/castletek-network-scan-host.h') + '\n' +
    read('wled00/castletek_wled_scan.cpp').replace('#include "wled.h"', '') + '\n' +
    read('test/fixtures/castletek-network-scan-host.cpp');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-network-scan-'));
  try {
    const file = path.join(temp, 'scan.cpp'), binary = path.join(temp, 'scan');
    fs.writeFileSync(file, source);
    const result = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror',
      '-DCASTLETEK_WLED_COMPAT', '-DARDUINO_ARCH_ESP32', '-I', path.join(root, 'wled00'), file, '-o', binary],
      { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    const ran = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /scan checks passed: \d+/);
    process.stdout.write(ran.stdout);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Compatibility scan dispatch stays scoped and receives the native completion status', () => {
  const json = read('wled00/json.cpp');
  const dispatch = json.slice(json.indexOf('    case json_target::networks:'), json.indexOf('    case json_target::config:'));
  assert.match(dispatch, /#if defined\(CASTLETEK_WLED_COMPAT\) && defined\(ARDUINO_ARCH_ESP32\)/);
  assert.match(dispatch, /castleTekWLEDSerializeNetworks\(lDoc, request->hasParam\(F\("refresh"\)\) && request->getParam\(F\("refresh"\)\)->value\(\) == F\("1"\)\)/);
  assert.match(dispatch, /#else\s+serializeNetworks\(lDoc\);\s+#endif/);
  const network = read('wled00/network.cpp');
  assert.match(network, /case ARDUINO_EVENT_WIFI_SCAN_DONE:\s+#ifdef CASTLETEK_WLED_COMPAT\s+castleTekWLEDNetworkScanDone\(info.wifi_scan_done.status\);/);
  assert.match(network, /#if defined\(CASTLETEK_WLED_COMPAT\) && defined\(ARDUINO_ARCH_ESP32\)\s+void WiFiEvent\(WiFiEvent_t event, WiFiEventInfo_t info\)\s+#else\s+void WiFiEvent\(WiFiEvent_t event\)/);
});
