const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('production offline sync connection owner holds its channel and restores explicit Wi-Fi recovery', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-sync-wifi-'));
  try {
    const production = read('wled00/castletek_sync_wifi.cpp').replace('#include "wled.h"\n', '');
    const source = read('test/fixtures/castletek-sync-wifi-host.cpp').replace('// PRODUCTION', production);
    const sourcePath = path.join(temporary, 'wifi.cpp'), binary = path.join(temporary, 'wifi');
    fs.writeFileSync(sourcePath, source);
    const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', sourcePath, '-o', binary], {encoding:'utf8',timeout:60000});
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], {encoding:'utf8',timeout:15000});
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /CastleTek sync Wi-Fi lifecycle checks passed: \d+/);
    process.stdout.write(ran.stdout);
  } finally { fs.rmSync(temporary, {recursive:true,force:true}); }
});

test('Compatibility holds before native retries, keeps protected AP defaults, and owns sync outside Wi-Fi saves', () => {
  const main = read('wled00/wled.cpp'), network = read('wled00/network.cpp'), settings = read('wled00/set.cpp');
  assert.match(main, /void WLED::handleConnection\(\)\s*\{\s*#ifdef CASTLETEK_WLED_COMPAT\s*if \(castleTekWLEDHandleSyncConnection\(\)\) return;/);
  assert.match(main, /castleTekWLEDSyncUsesOfflineAP\(\) && WiFi.status\(\) != WL_CONNECTED \? castleTekWLEDSyncOfflineChannel\(\) : apChannel/);
  assert.match(network, /&& !castleTekWLEDSyncOfflineHeld\(\)/);
  assert.match(network, /if \(castleTekWLEDSyncOfflineHeld\(\)\) \{ interfacesInited = false; break; \}/);
  assert.match(settings, /#if !defined\(WLED_DISABLE_ESPNOW\) && !defined\(CASTLETEK_WLED_COMPAT\)\s*bool oldESPNow/);
  assert.match(settings, /Sync Interfaces owns radio\/senders[\s\S]*?castleTekWLEDResumeWiFi\(\);/);
  assert.match(read('wled00/castletek_wled_wifi.cpp'), /apChannel = 6;/);
  assert.match(read('wled00/improv.cpp'), /#ifdef CASTLETEK_WLED_COMPAT\s*castleTekWLEDResumeWiFi\(\);\s*#else\s*forceReconnect = true;\s*#endif\s*serializeConfigToFS\(\);/);
});
