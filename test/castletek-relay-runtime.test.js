const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'wled00', name), 'utf8');
function between(text, first, last) {
  const a = text.indexOf(first), b = text.indexOf(last, a);
  assert.ok(a >= 0 && b > a, first);
  return text.slice(a, b);
}
for (const fixed of [false, true]) test(`relay boot and GPIO ownership execute production code (${fixed ? 'Dig-Quad' : 'generic'})`, () => {
  const policy = read('castletek_wled_hardware.cpp');
  const pin = read('pin_manager.cpp');
  const source = `
#include <cassert>
#include <cstdint>
#include <string>
#include <sstream>
#include "src/dependencies/json/ArduinoJson-v6.h"
using byte = uint8_t;
#define F(x) x
#define PSTR(x) x
#define DEBUG_PRINTF_P(...)
#define WLED_NUM_PINS 40
#define OUTPUT 1
#define OUTPUT_OPEN_DRAIN 2
#define bitWrite(v,b,x) ((x) ? ((v) |= (1ULL << (b))) : ((v) &= ~(1ULL << (b))))
enum class PinOwner { None, Relay, BusDigital, BusPwm, BusOnOff, HW_I2C, HW_SPI, DMX_INPUT, Ethernet, Button };
struct managed_pin_type { byte pin; bool isOutput; };
static uint64_t pinAlloc = 0;
static PinOwner ownerTag[40] = {};
static unsigned i2cAllocCount = 0, spiAllocCount = 0;
${between(policy, 'int castleTekWLEDFixedRelayPin()', 'bool castleTekWLEDIsFixedLEDPin(')}
bool castleTekWLEDIsFixedLEDPin(int gpio) { return gpio == 16; }
namespace PinManager {
  bool isPinOk(byte gpio, bool) { return gpio < 40; }
  bool isPinAllocated(byte gpio, PinOwner tag = PinOwner::None) { return gpio < 40 && ((pinAlloc >> gpio) & 1) && (tag == PinOwner::None || ownerTag[gpio] == tag); }
  bool deallocatePin(byte gpio, PinOwner tag) { if (!isPinAllocated(gpio, tag)) return false; bitWrite(pinAlloc,gpio,false); ownerTag[gpio] = PinOwner::None; return true; }
  bool allocatePin(byte, bool, PinOwner);
  bool allocateMultiplePins(const managed_pin_type*, byte, PinOwner);
}
${between(pin, 'bool PinManager::allocateMultiplePins(const managed_pin_type', 'bool PinManager::allocateMultiplePins(const int8_t')}
${between(pin, 'bool PinManager::allocatePin(byte', '// if tag is set to PinOwner::None')}
struct Print { std::ostringstream stream; template<class T> void print(T value) { stream << value; } };
${between(read('xml.cpp'), 'static void extractPin(', 'static void fillWLEDVersion(')}
int rlyPin = -1, lastModePin = -1;
bool rlyOpenDrain = false, rlyMde = true;
void pinMode(int pin, int) { lastModePin = pin; }
bool load(JsonObject hw, bool fromFS) {
 bool needsSave = false;
${between(read('cfg.cpp'), '  JsonObject relay = hw[F("relay")];', '  CJSON(serialBaud')}
 return needsSave;
}
void clear() { pinAlloc = 0; for (auto& tag : ownerTag) tag = PinOwner::None; rlyPin = -1; lastModePin = -1; }
int main() {
 const bool fixed = castleTekWLEDFixedRelayPin() >= 0;
 DynamicJsonDocument metadata(1024); auto mic = metadata.to<JsonObject>();
 auto pins = mic.createNestedArray("pin"); pins.add(32); pins.add(15); pins.add(14); pins.add(-1);
 Print array; extractPin(array,mic,"pin");
 assert(array.stream.str() == (fixed ? ",32,14" : ",32,15,14"));
 mic["pin"] = 15; Print scalar; extractPin(scalar,mic,"pin");
 assert(scalar.stream.str() == (fixed ? "" : ",15"));
 for (PinOwner owner : {PinOwner::Relay, PinOwner::Button, PinOwner::BusDigital}) {
  clear(); assert(PinManager::allocatePin(15,true,owner) == (!fixed || owner == PinOwner::Relay));
 }
 clear(); assert(!PinManager::allocatePin(16,true,PinOwner::Relay));
 managed_pin_type pair[] = {{14,true},{15,true}};
 clear(); assert(PinManager::allocateMultiplePins(pair,2,PinOwner::HW_SPI) == !fixed);
 assert(PinManager::isPinAllocated(14) == !fixed); // multi-pin rejection is atomic
 for (int saved : {-2,-1,0,15,23}) {
  clear(); DynamicJsonDocument doc(1024); auto hw = doc.to<JsonObject>();
  if (saved != -2) hw["relay"]["pin"] = saved;
  bool needsSave = load(hw,true);
  assert(needsSave == (fixed && saved != 15));
  int expected = fixed ? 15 : (saved < 0 ? -1 : saved);
  assert(rlyPin == expected);
  if (expected >= 0) assert(lastModePin == expected && PinManager::isPinAllocated(expected,PinOwner::Relay));
 }
 clear(); DynamicJsonDocument doc(1024); auto hw = doc.to<JsonObject>();
 hw["relay"]["pin"] = 15; assert(!load(hw,true));
 hw.remove("relay"); assert(!load(hw,false)); assert(rlyPin == 15 && PinManager::isPinAllocated(15,PinOwner::Relay));
 hw["relay"]["pin"] = 15; hw["relay"]["rev"] = true; hw["relay"]["odrain"] = true;
 assert(!load(hw,false)); assert(rlyPin == 15 && !rlyMde && rlyOpenDrain);
}
`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-relay-'));
  try {
    fs.writeFileSync(path.join(temp, 'test.cpp'), source);
    const result = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-DCASTLETEK_WLED_COMPAT', ...(fixed ? ['-DCASTLETEK_WLED_FIXED_RELAY_PIN=15'] : []), '-I', path.join(root, 'wled00'), path.join(temp, 'test.cpp'), '-o', path.join(temp, 'test')], {encoding:'utf8', timeout:60000});
    assert.equal(result.status, 0, result.stderr);
    const ran = spawnSync(path.join(temp, 'test'), [], {encoding:'utf8', timeout:10000});
    assert.equal(ran.status, 0, ran.stderr);
  } finally { fs.rmSync(temp, {recursive:true,force:true}); }
});
