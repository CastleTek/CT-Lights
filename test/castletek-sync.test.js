const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('production Compatibility schema4 sync validates both transports, sender identity, durable writes and ESP-NOW-absent builds', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-sync-'));
  try {
    // Compile actual production functions with host network/storage/clock fakes.
    // The host uses std::string instead of Arduino String only for JSON MAC text.
    const production = read('wled00/castletek_wled_sync.cpp')
      .replace('#include "wled.h"\n', '')
      .replace('String ctSyncMAC(bool ap)', 'std::string ctSyncMAC(bool ap)');
    const source = read('test/fixtures/castletek-sync-host.h') + '\n' + production + '\n' + read('test/fixtures/castletek-sync-host.cpp');
    const sourcePath = path.join(temporary, 'sync.cpp');
    const binary = path.join(temporary, 'sync');
    fs.writeFileSync(sourcePath, source);
    for (const flags of [[], ['-DWLED_DISABLE_ESPNOW']]) {
    const compiled = spawnSync(process.env.CXX || 'c++', [...flags, '-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-I', path.join(root, 'wled00'), sourcePath, '-o', binary], {encoding:'utf8',timeout:60000});
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], {encoding:'utf8',timeout:15000});
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /CastleTek sync runtime checks passed: \d+/);
    process.stdout.write(ran.stdout);
    }
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
});

test('Compatibility DMX feature gates preserve DDP and saved network output identities', () => {
  const header = read('wled00/wled.h');
  assert.match(header, /#ifdef CASTLETEK_WLED_COMPAT[\s\S]*?#define WLED_DISABLE_MQTT[\s\S]*?#define WLED_DISABLE_HUESYNC[\s\S]*?#undef WLED_ENABLE_DMX[\s\S]*?#undef WLED_ENABLE_DMX_INPUT/);
  assert.match(read('wled00/set.cpp'), /#ifndef CASTLETEK_WLED_COMPAT\s+\/\/ Retired DMX form fields[\s\S]*?e131SkipOutOfSequence = request->hasArg[\s\S]*?DMXMode = t;\s+#endif/);
  const e131 = read('wled00/e131.cpp');
  assert.match(e131, /#ifdef CASTLETEK_WLED_COMPAT\s+if \(protocol == P_DDP\)[\s\S]*?handleDDPPacket\(p, packetLen\);[\s\S]*?#else/);
  const udp = read('wled00/udp.cpp');
  assert.match(udp, /const bool syncTransportReady = useESPNowSync \? \(enableESPNow && statusESPNow == ESP_NOW_STATE_ON\) : udpConnected;/);
  assert.match(udp, /case 0: \/\/ DDP[\s\S]*?#ifndef CASTLETEK_WLED_COMPAT\s+case 1: \/\/E1.31/);
  assert.match(udp, /default: return 1; \/\/ DMX transports are unavailable; saved rows are retained/);
  const buses = read('wled00/bus_manager.cpp');
  assert.match(buses, /#ifndef CASTLETEK_WLED_COMPAT\s+\{TYPE_NET_ARTNET_RGB,/);
  assert.match(buses, /case TYPE_NET_ARTNET_RGB:[\s\S]*?_UDPtype = 2/);
  assert.match(buses, /\{TYPE_NET_DDP_RGB,/);
  assert.match(buses, /\{TYPE_NET_DDP_RGBW,/);
});

test('Compatibility appearance filters are literal and ESP-NOW state application is deferred to the main loop', () => {
  const udp = read('wled00/udp.cpp');
  assert.match(udp, /if \(receiveNotificationPowerOnly\)[\s\S]*?powerBrightness\(udpIn\[2\], bri, briLast\)[\s\S]*?return;[\s\S]*?const bool someSel = true;\s+#else\s+bool someSel =/);
  assert.match(udp, /if \(!\(receiveNotificationBrightness \|\| receiveNotificationColor \|\| receiveNotificationEffects \|\| receiveNotificationPalette \|\| receiveSegmentOptions \|\| receiveSegmentBounds\)\) return/);
  assert.match(udp, /void handleNotifications\(\)[\s\S]*?castleTekWLEDTakeSync[\s\S]*?parseNotifyPacket/);
  assert.match(udp, /if \(data\[0\] == 'W'\) \{\s+castleTekWLEDReceiveSync\(address, data, len, broadcast\);\s+return;/);
  assert.match(read('wled00/cfg.cpp'), /if \(fromFS \|\| nw.containsKey\(F\("linked_remote"\)\)\)/);
});


test('schema4 release contract declares the complete channel-aware native and JSON interfaces', () => {
  const contract = JSON.parse(read('castletek/compatibility-v1/routes.json')).syncPolicy;
  assert.equal(contract.schema, 4);
  assert.equal(contract.settingsFields.length, 17);
  assert.ok(contract.settingsFields.includes("interfaces"));
  assert.deepEqual(contract.interfaces.timeoutMilliseconds, {min: 100, max: 65000, step: 100});
  assert.ok(contract.settingsFields.includes('offlineChannel'));
  assert.ok(contract.readFields.includes('wifiConnected'));
  assert.deepEqual(contract.offlineChannel.range, [1, 11]);
  assert.equal(contract.offlineChannel.factoryDefault, 1);
  assert.equal(contract.offlineChannel.autoAlignment, false);
  assert.equal(contract.browser.replacementMarker, 'CTSYNC=3');
  assert.ok(contract.browser.fields.includes('CTOC'));
});
