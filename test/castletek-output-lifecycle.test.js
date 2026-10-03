const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `missing production function: ${signature}`);
  const opening = source.indexOf('{', start);
  let depth = 1;
  for (let i = opening + 1; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated production function: ${signature}`);
}

test('output reinitialization removes disabled LED ranges, repairs segments, and flushes black before releasing drivers', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'wled00/wled.cpp'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'wled00/FX_fcn.cpp'), 'utf8');
  const buses = fs.readFileSync(path.join(root, 'wled00/bus_manager.cpp'), 'utf8');
  const decisionStart = main.indexOf('bool aligned = strip.checkSegmentAlignment();');
  const decisionEnd = main.indexOf('BusManager::setBrightness(', decisionStart);
  assert.ok(decisionStart >= 0 && decisionEnd > decisionStart);
  const decision = main.slice(decisionStart, decisionEnd);
  const frameStart = engine.indexOf('for (auto &bus : BusManager::busses)', engine.indexOf('void WS2812FX::finalizeInit()'));
  const release = engine.indexOf('BusManager::removeAll();', frameStart);
  assert.ok(frameStart >= 0 && release > frameStart);
  // Keep the actual guarded block and removeAll call together so moving removal
  // ahead of the flush or dropping its transfer wait fails this lifecycle test.
  const guardedStart = engine.lastIndexOf('#ifdef CASTLETEK_WLED_COMPAT', frameStart);
  const flushAndRelease = engine.slice(guardedStart, release + 'BusManager::removeAll();'.length);
  const aggregateStart = engine.indexOf('  _length = 0;', release);
  const aggregateEnd = engine.indexOf('  BusManager::initializeABL();', aggregateStart);
  assert.ok(aggregateStart >= 0 && aggregateEnd > aggregateStart);
  const aggregate = engine.slice(aggregateStart, aggregateEnd);
  const functions = [
    'void WS2812FX::purgeSegments()',
    'void WS2812FX::resetSegments()',
    'void WS2812FX::makeAutoSegments(bool forceReset)',
    'void WS2812FX::fixInvalidSegments()',
    'bool WS2812FX::checkSegmentAlignment() const',
  ].map(signature => functionSource(engine, signature)).join('\n');
  const removeAll = functionSource(buses, 'void BusManager::removeAll()');
  const source = `
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <iostream>
#include <memory>
#include <string>
#include <vector>
#define WLED_DISABLE_2D
#define MAX_NUM_SEGMENTS 32
#define MAX_LEDS 10000
#define ERR_NORAM_PX 1
#define F(x) x
#define PSTR(x) x
#define DEBUGBUS_PRINTLN(...)
#define DEBUGFX_PRINTF_P(...)
using std::min;
using std::max;
int errorFlag = 0;
uint8_t bri = 0;
uint8_t scaledBri(uint8_t value) { return value; }
static std::vector<std::string> events;
static bool requireBlackOnRelease = true;
struct Bus {
  unsigned start, length;
  bool enabled, valid = true, placeholder = false;
  bool blackBrightness = false, blackStatus = false, shown = false;
  mutable unsigned pending = 1;
  std::vector<uint32_t> pixels;
  Bus(unsigned s, unsigned n, bool on = true) : start(s), length(n), enabled(on), pixels(n, 0xffffff) {}
  ~Bus() {
    if (requireBlackOnRelease && valid && !placeholder) {
      assert(shown && pending == 0 && blackBrightness && blackStatus);
      for (auto pixel : pixels) assert(pixel == 0);
    }
    if (placeholder || !valid) assert(!shown);
    events.push_back("release");
  }
  unsigned getStart() const { return start; }
  unsigned getLength() const { return enabled ? length : 0; }
  bool isEnabled() const { return enabled; }
  bool containsPixel(unsigned p) const { return enabled && p >= start && p < start + length; }
  bool isOk() const { return valid; }
  bool isPlaceholder() const { return placeholder; }
  bool hasWhite() const { return false; }
  bool isOffRefreshRequired() const { return false; }
  bool isPWM() const { return false; }
  void begin() { pending = 0; }
  bool canShow() const { return pending == 0; }
  void setBrightness(uint8_t b) { assert(canShow() && b == 0); blackBrightness = true; }
  void setPixelColor(unsigned i, uint32_t color) { assert(canShow() && i < length); pixels[i] = color; }
  void setStatusPixel(uint32_t color) { assert(canShow() && color == 0); blackStatus = true; }
  void show() {
    assert(canShow() && blackBrightness && blackStatus);
    for (auto pixel : pixels) assert(pixel == 0);
    shown = true; pending = 2; events.push_back("black-show");
  }
};
namespace BusManager {
  std::vector<std::unique_ptr<Bus>> busses;
  size_t getNumBusses() { return busses.size(); }
  Bus* getBus(size_t i) { return i < busses.size() ? busses[i].get() : nullptr; }
  bool canAllShow() {
    for (const auto& bus : busses) if (!bus->canShow()) return false;
    return true;
  }
  void removeAll();
}
namespace PolyBus { void resetChannelTracking() { events.push_back("reset-channels"); } }
void yield() {
  events.push_back("wait");
  for (const auto& bus : BusManager::busses) if (bus->pending) bus->pending--;
}
${removeAll}
struct BusConfig { unsigned start, count; bool enabled; };
std::vector<BusConfig> busConfigs;
struct Segment {
  static constexpr unsigned maxWidth = 13, maxHeight = 1;
  unsigned start, stop, startY, stopY;
  std::string name;
  mutable unsigned capabilityRefreshes = 0;
  Segment(unsigned s = 0, unsigned e = 0, unsigned y = 0, unsigned ey = 1) : start(s), stop(e), startY(y), stopY(ey) {}
  void setGeometry(unsigned s, unsigned e) { start = s; stop = e; }
  void refreshLightCapabilities() const { capabilityRefreshes++; }
};
struct WS2812FX {
  std::vector<Segment> _segments;
  unsigned _length = 13, _mainSegment = 0;
  bool isMatrix = false, autoSegments = true, _hasWhiteChannel = false, _isOffRefreshRequired = false;
  bool mappedFront = false;
  unsigned getLengthTotal() const { return _length; }
  uint16_t getMappedPixelIndex(unsigned p) const { return mappedFront && p < 5 ? p + 20 : p; }
  bool isServicing() const { return false; }
  size_t getSegmentsNum() const { return _segments.size(); }
  size_t getActiveSegmentsNum() const { return std::count_if(_segments.begin(), _segments.end(), [](const Segment& s) { return s.stop > s.start; }); }
  size_t getLastActiveSegmentId() const { return _segments.size() - 1; }
  void setMainSegmentId(unsigned value) { _mainSegment = value; }
  void purgeSegments();
  void resetSegments();
  void makeAutoSegments(bool forceReset = false);
  void fixInvalidSegments();
  bool checkSegmentAlignment() const;
  void finalizeInit() {
    ${flushAndRelease}
    _length = 0;
    // Only driver allocation is a fixture adapter; flush, release, segment
    // routing and segment mutation helpers are extracted production code.
    for (const auto& row : busConfigs) {
      auto bus = std::make_unique<Bus>(row.start, row.count, row.enabled);
      bus->placeholder = !row.enabled;
      if (bus->placeholder) bus->pending = 0;
      BusManager::busses.push_back(std::move(bus));
    }
    ${aggregate}
  }
};
${functions}
WS2812FX strip;
void reinitialize() { ${decision} }
int main() {
  for (unsigned i = 0; i < 4; i++) {
    const unsigned start = i ? 9+i : 0, length = i ? 1 : 10;
    BusManager::busses.emplace_back(new Bus(start, length));
    strip._segments.emplace_back(start, start + length);
    strip._segments.back().name = "named-" + std::to_string(i);
    busConfigs.push_back({start, length, false});
  }
  strip._mainSegment = 2;
  assert(strip.autoSegments && strip.checkSegmentAlignment());
  reinitialize(); // No output owns any logical LEDs while all are off.
  assert(strip._length == 0 && strip._segments.size() == 1 && strip._segments[0].stop == 0);
  assert(std::count(events.begin(), events.end(), "black-show") == 4);
  assert(std::count(events.begin(), events.end(), "release") == 4);
  auto firstRelease = std::find(events.begin(), events.end(), "release");
  assert(std::count(events.begin(), firstRelease, "black-show") == 4);
  assert(events.back() == "reset-channels");
  busConfigs[2] = {0, 1, true};
  reinitialize(); // LED3 can be the only active output, starting from zero.
  assert(strip._length == 1 && strip._segments.size() == 1 && strip._segments[0].stop == 1);
  assert(BusManager::busses[2]->enabled);
  assert(std::count(events.begin(), events.end(), "black-show") == 4);
  busConfigs[0] = {0, 10, true};
  busConfigs[1] = {20, 10, true};
  busConfigs[2] = {10, 10, true};
  busConfigs[3] = {8000, 1, false};
  reinitialize(); // Physical connector order need not match logical LED order.
  assert(strip._length == 30 && strip._segments.size() == 3);
  assert(strip._segments[0].start == 0 && strip._segments[0].stop == 10);
  assert(strip._segments[1].start == 20 && strip._segments[1].stop == 30);
  assert(strip._segments[2].start == 10 && strip._segments[2].stop == 20);
  busConfigs[2].enabled = false;
  reinitialize(); // Disabling an interior output leaves its gap, not a fake segment.
  assert(strip._length == 30 && strip._segments.size() == 2);
  assert(strip._segments[0].stop == 10 && strip._segments[1].start == 20);
  strip._segments[0].name = "front";
  strip._segments[1].name = "back";
  busConfigs[3] = {40, 900, false};
  reinitialize(); // Editing disabled metadata changes no active geometry or names.
  assert(strip._length == 30 && strip._segments.size() == 2);
  assert(strip._segments[0].name == "front" && strip._segments[1].name == "back");
  busConfigs[2].enabled = true;
  reinitialize();
  strip._segments.clear();
  strip._segments.emplace_back(0, 5); strip._segments.back().name = "front custom";
  strip._segments.emplace_back(10, 15); strip._segments.back().name = "removed custom";
  strip._segments.emplace_back(20, 25); strip._segments.back().name = "back custom";
  strip._segments.emplace_back(5, 25); strip._segments.back().name = "spanning custom";
  strip._mainSegment = 2;
  assert(!strip.checkSegmentAlignment());
  busConfigs[2].enabled = false;
  reinitialize();
  assert(strip._segments.size() == 3 && strip._length == 30);
  assert(strip._segments[0].name == "front custom" && strip._segments[0].start == 0 && strip._segments[0].stop == 5);
  assert(strip._segments[1].name == "back custom" && strip._segments[1].start == 20 && strip._segments[1].stop == 25);
  assert(strip._segments[2].name == "spanning custom" && strip._segments[2].start == 5 && strip._segments[2].stop == 25);
  assert(strip._mainSegment == 1); // The same selected segment survives an earlier removal.
  strip.mappedFront = true; // A saved LED map points front-custom LEDs onto LED2.
  busConfigs[0].enabled = false;
  reinitialize();
  assert(strip._segments.size() == 3 && strip._segments[0].name == "front custom");
  assert(strip._segments[1].name == "back custom" && strip._segments[2].name == "spanning custom");
  strip.mappedFront = false;
  reinitialize();
  assert(strip._segments.size() == 2 && strip._segments[0].name == "back custom");
  assert(strip._segments[1].name == "spanning custom");
  busConfigs[1].enabled = false;
  reinitialize();
  assert(strip._length == 0 && strip._segments.size() == 1 && strip._segments[0].stop == 0);
  strip.autoSegments = false;
  busConfigs[2] = {7, 10, true};
  reinitialize(); // Native single segment is restored even with auto-segments off.
  assert(strip._length == 17 && strip._segments.size() == 1);
  assert(strip._segments[0].start == 0 && strip._segments[0].stop == 17);
  busConfigs[2].enabled = false;
  reinitialize();
  assert(strip._length == 0 && strip.getActiveSegmentsNum() == 0);
  busConfigs[0] = {0, 10, true};
  reinitialize();
  assert(strip._length == 10 && strip.getActiveSegmentsNum() == 1 && strip._segments[0].stop == 10);
  requireBlackOnRelease = false;
  BusManager::busses.clear();
  std::cout << "segment and driver lifecycle checks passed\\n";
}

`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-output-lifecycle-'));
  try {
    const file = path.join(temp, 'lifecycle.cpp');
    fs.writeFileSync(file, source);
    const binary = path.join(temp, 'lifecycle');
    const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-DCASTLETEK_WLED_COMPAT', file, '-o', binary], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /segment and driver lifecycle checks passed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('all-disabled segment construction and editing allocate no pixels; stock retains native constructor semantics', () => {
  const root = path.resolve(__dirname, '..');
  const header = fs.readFileSync(path.join(root, 'wled00/FX.h'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'wled00/FX_fcn.cpp'), 'utf8');
  const begin = header.indexOf('    Segment(uint16_t sStart=');
  const end = header.indexOf('    Segment(const Segment &orig);', begin);
  assert.ok(begin >= 0 && end > begin);
  const constructor = header.slice(begin, end);
  const geometry = functionSource(engine, 'void Segment::setGeometry(');
  const defaults = header.split('\n').filter(line => /^#define DEFAULT_(MODE|SPEED|INTENSITY|COLOR|C1|C2|C3)\s/.test(line)).join('\n');
  const source = `
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstdlib>
#define WLED_DISABLE_2D
#define DEBUGFX_PRINTF_P(...)
#define DEBUGFX_PRINTLN(...)
#define PSTR(x) x
#define F(x) x
#define BLACK 0
#define SELECTED 1
#define SEGMENT_ON 4
#define BFRALLOC_PREFER_PSRAM 1
#define BFRALLOC_NOBYTEACCESS 2
#define BFRALLOC_CLEAR 4
#define ERR_NORAM_PX 1
#define MIN(a,b) std::min<unsigned>(a,b)
#define constrain(x,a,b) ((x)<(a)?(a):((x)>(b)?(b):(x)))
${defaults}
using byte = uint8_t;
byte errorFlag = 0;
bool stateChanged = false;
static unsigned allocations = 0;
void* allocate_buffer(size_t count, unsigned) { assert(count > 0); allocations++; return std::calloc(1, count); }
void p_free(void* p) { std::free(p); }
struct Strip { unsigned getLengthTotal() const; } strip;
struct Segment {
  uint32_t colors[3];
  uint16_t start, stop, startY, stopY, offset, options, grouping, spacing, opacity, cct, mode, palette, speed, intensity;
  uint16_t custom1, custom2, custom3;
  bool check1, check2, check3;
  uint16_t blendMode;
  char* name;
  unsigned step, call, aux0, aux1;
  uint8_t* data;
  unsigned _dataLen, _default_palette, _capabilities;
  void* _t;
  uint32_t* pixels;
  unsigned map1D2D = 0;
  static uint16_t maxWidth, maxHeight;
  ${constructor}
  ~Segment() { p_free(pixels); }
  unsigned length() const { return stop > start ? stop - start : 0; }
  bool isActive() const { return stop > start && pixels; }
  void setGeometry(uint16_t i1, uint16_t i2, uint8_t grp=1, uint8_t spc=0, uint16_t ofs=UINT16_MAX, uint16_t i1Y=0, uint16_t i2Y=1, uint8_t m12=0);
  void clear() {}
  void markForReset() {}
  void stopTransition() { _t = nullptr; }
  void deallocateData() { p_free(data); data = nullptr; }
  void refreshLightCapabilities() const {}
};
uint16_t Segment::maxWidth = 0, Segment::maxHeight = 1;
unsigned Strip::getLengthTotal() const { return Segment::maxWidth; }
${geometry}
int main() {
  Segment disabled(0, 0);
  #ifdef CASTLETEK_WLED_COMPAT
  assert(!disabled.isActive() && disabled.pixels == nullptr && allocations == 0 && errorFlag == 0);
  disabled.setGeometry(0, 200); // Stale/manual geometry may not manufacture a pixel.
  assert(!disabled.isActive() && disabled.pixels == nullptr && allocations == 0);
  Segment::maxWidth = 17;
  disabled.setGeometry(7, 17);
  assert(disabled.isActive() && disabled.start == 7 && disabled.stop == 17 && allocations == 1);
  Segment::maxWidth = 0;
  disabled.setGeometry(7, 17);
  assert(!disabled.isActive() && disabled.pixels == nullptr && allocations == 1);
  #else
  assert(disabled.isActive() && disabled.stop == 1 && allocations == 1); // Stock behavior is untouched.
  #endif
}
`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-output-zero-buffer-'));
  try {
    const file = path.join(temp, 'segments.cpp');
    fs.writeFileSync(file, source);
    for (const compatibility of [false, true]) {
      const binary = path.join(temp, compatibility ? 'compatibility' : 'stock');
      const flags = compatibility ? ['-DCASTLETEK_WLED_COMPAT'] : [];
      const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', ...flags, file, '-o', binary], { encoding: 'utf8', timeout: 60000 });
      assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
      const ran = spawnSync(binary, [], { encoding: 'utf8', timeout: 10000 });
      assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
