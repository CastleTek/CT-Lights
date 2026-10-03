const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('disabled connector objects retain settings and GPIO ownership without active pixels', () => {
  const root = path.resolve(__dirname, '..');
  const header = fs.readFileSync(path.join(root, 'wled00/bus_manager.h'), 'utf8');
  const implementation = fs.readFileSync(path.join(root, 'wled00/bus_manager.cpp'), 'utf8');
  const bus = header.slice(header.indexOf('class Bus {'), header.indexOf('class BusDigital :'));
  const placeholder = header.slice(header.indexOf('class BusPlaceholder :'), header.indexOf('#ifdef WLED_ENABLE_HUB75MATRIX', header.indexOf('class BusPlaceholder :')));
  const configuration = header.slice(header.indexOf('struct BusConfig {'), header.indexOf('// milliamps used by ESP'));
  const constructor = implementation.slice(implementation.indexOf('BusPlaceholder::BusPlaceholder'), implementation.indexOf('//utility to get the approx. memory usage'));
  const source = `
#include <cassert>
#include <algorithm>
#include <cstring>
#include <cstdint>
#include <iostream>
#include <memory>
#include <map>
#include <set>
#include <string>
#include <vector>
#define LEDC_CHANNEL_MAX 8
#define LEDC_SPEED_MODE_MAX 2
#include "const.h"
#define F(x) x
#define PSTR(x) x
#define DEBUGBUS_PRINTF_P(...)
#define GET_BIT(var,bit) (((var)>>(bit))&0x01)
#define LOW 0
#define HIGH 1
#define OUTPUT 1
using byte = uint8_t;
using String = std::string;
struct LEDType { uint8_t id; const char* type; const char* name; };
enum class PinOwner { BusDigital };
namespace PinManager {
  std::set<uint8_t> allocated;
  bool allocatePin(uint8_t pin, bool, PinOwner) { return allocated.insert(pin).second; }
  bool deallocatePin(uint8_t pin, PinOwner) { return allocated.erase(pin) == 1; }
}
static std::map<uint8_t, int> pinLevels;
void digitalWrite(uint8_t pin, int value) { pinLevels[pin] = value; }
void pinMode(uint8_t, int mode) { assert(mode == OUTPUT); }
bool castleTekWLEDValidateBus(uint8_t, const uint8_t*) { return true; }
static unsigned blocked = 0;
void castleTekWLEDRecordBlockedBus() { blocked++; }
struct BusConfig;
${bus}
${placeholder}
${configuration}
${constructor}
struct Probe : BusPlaceholder {
  using BusPlaceholder::BusPlaceholder;
  uint8_t brightness() const { return _bri; }
};
int main() {
  uint8_t pins[OUTPUT_MAX_PINS] = {16,255,255,255,255};
  BusConfig saved(TYPE_SK6812_RGBW, pins, 50, 37, COL_ORDER_GRB, true, 2, RGBW_MODE_MANUAL_ONLY, 0, 45, 900, 1, "retained");
  saved.enabled = false;
  assert(!saved.requiresDriver());
  {
    Probe off(saved);
    assert(off.isOk() && off.isPlaceholder() && !off.isEnabled());
    assert(off.getStart() == 50 && off.getLength() == 0 && off.getConfiguredLength() == 37 && off.getType() == TYPE_SK6812_RGBW);
    assert(off.hasRGB() && off.hasWhite() && !off.hasCCT()); // Retained driver type, not active range.
    assert(!off.containsPixel(50) && !off.containsPixel(86));
    assert(off.isReversed() && off.skippedLeds() == 2 && off.getColorOrder() == COL_ORDER_GRB);
    assert(off.getLEDCurrent() == 45 && off.getMaxCurrent() == 900 && off.getDriverType() == 1);
    assert(off.getCustomText() == "retained");
    uint8_t retained[OUTPUT_MAX_PINS];
    assert(off.getPins(retained) == 1 && retained[0] == 16);
    assert(PinManager::allocated.count(16) && pinLevels.at(16) == LOW);
    {
      Probe conflict(saved);
      assert(!conflict.isOk() && !conflict.isEnabled() && blocked == 1);
    }
    assert(PinManager::allocated.count(16)); // A failed reservation cannot release another bus's pin.
    off.setBrightness(255); off.setStatusPixel(0xffffffff); off.setPixelColor(0, 0xffffffff); off.show();
    assert(off.brightness() == 0 && off.getPixelColor(0) == 0 && off.canShow());
  }
  assert(PinManager::allocated.empty());
  for (const uint8_t type : {TYPE_ONOFF, TYPE_ANALOG_1CH}) {
    for (bool reversed : {false, true}) {
      BusConfig polarity(type, pins, 0, 1, COL_ORDER_GRB, reversed);
      polarity.enabled = false;
      Probe off(polarity);
      assert(off.isOk() && !off.isEnabled());
      assert(pinLevels.at(16) == (reversed ? HIGH : LOW));
      off.setBrightness(255); off.setPixelColor(0, 0xffffffff); off.show();
      assert(pinLevels.at(16) == (reversed ? HIGH : LOW));
    }
  }
  saved.enabled = true;
  assert(saved.requiresDriver());
  Probe failed(saved);
  assert(!failed.isOk() && failed.isEnabled()); // Resource failure is distinct from disabled.
  saved.enabled = false;
  saved.type = TYPE_TM1814;
  assert(saved.requiresDriver()); // Keep a black-only driver for mandatory refresh.
  saved.type = TYPE_WS2812_RGB;
  saved.refreshReq = true;
  assert(saved.requiresDriver());
  saved.refreshReq = false;
  assert(!saved.requiresDriver());
  std::vector<std::unique_ptr<Probe>> disabled;
  const uint8_t physical[] = {16,3,1,4};
  for (unsigned i = 0; i < 4; i++) {
    pins[0] = physical[i];
    BusConfig row(TYPE_WS2812_RGB, pins, i ? 9+i : 0, i ? 1 : 10);
    row.enabled = false;
    disabled.emplace_back(new Probe(row));
  }
  unsigned total = 0;
  for (const auto& row : disabled) {
    assert(row->isOk() && row->hasRGB());
    if (row->getLength()) total = std::max(total, unsigned(row->getStart() + row->getLength()));
  }
  assert(total == 0 && PinManager::allocated.size() == 4);
  disabled.clear();
  assert(PinManager::allocated.empty());
  std::cout << "disabled connector runtime checks passed\\n";
}
`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-outputs-runtime-'));
  try {
    const file = path.join(temp, 'runtime.cpp');
    fs.writeFileSync(file, source);
    const binary = path.join(temp, 'runtime');
    const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-DCASTLETEK_WLED_COMPAT', '-I', path.join(root, 'wled00'), file, '-o', binary], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /runtime checks passed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
