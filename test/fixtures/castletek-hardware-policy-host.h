// Host adapters for running the production configuration policy without a MCU.
#include <cassert>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>
#define LEDC_CHANNEL_MAX 8
#define LEDC_SPEED_MODE_MAX 2
#include "const.h"
#include "src/dependencies/json/ArduinoJson-v6.h"

#define F(value) value
using byte = uint8_t;
using String = std::string;
#define WLED_AP_SSID "CastleTek-Setup"
#define WLED_AP_PASS "castletek"
static char apSSID[33] = WLED_AP_SSID;
static char apPass[65] = WLED_AP_PASS;
static byte apChannel = 6, apHide = 0, apBehavior = AP_BEHAVIOR_BOOT_NO_CONN;
static bool force802_3g = false;
static std::vector<int> multiWiFi = {0};
struct Bus {
  uint8_t type = TYPE_WS2812_RGB;
  uint8_t getType() const { return type; }
// PRODUCTION_BUS_METHODS
};
namespace BusManager {
  static std::vector<Bus> buses;
  static size_t getNumBusses() { return buses.size(); }
  static const Bus* getBus(size_t index) { return index < buses.size() ? &buses[index] : nullptr; }
}
struct Button {
  int pin, type, macroButton, macroLongPress, macroDoublePress;
};
static std::vector<Button> buttons = {{0, BTN_TYPE_PUSH, 0, 0, 0}};
static bool simplifiedUI = false;
static bool disablePullUp = false;
static int touchThreshold = 32;
static bool buttonPublishMqtt = false;
static bool irApplyToAllSelected = true;
static int i2c_sda = -1, i2c_scl = -1;
static int spi_mosi = -1, spi_sclk = -1, spi_miso = -1;
using PSRAMDynamicJsonDocument = DynamicJsonDocument;
static const char* installedUsermods = "{}";
static bool overflowUsermods = false;
namespace UsermodManager {
  static void addToConfig(JsonObject& root) {
    if (overflowUsermods) {
      root["too-large"] = std::string(JSON_BUFFER_SIZE * 2, 'x');
      return;
    }
    DynamicJsonDocument current(4096);
    assert(!deserializeJson(current, installedUsermods));
    root.set(current.as<JsonObject>());
  }
}

static std::string persistedConfig;
static unsigned persistedReads = 0;
class File {
  std::istringstream bytes;
  bool opened = false;
public:
  File() = default;
  explicit File(const std::string& value) : bytes(value), opened(true) {}
  explicit operator bool() const { return opened; }
  int available() { return opened && bytes.peek() != EOF; }
  int read() { return opened ? bytes.get() : -1; }
  size_t readBytes(char* out, size_t count) { bytes.read(out, count); return size_t(bytes.gcount()); }
  void close() { opened = false; }
};
struct ReadOnlyFS {
  bool exists(const char* path) const { return std::string(path) == "/cfg.json" && !persistedConfig.empty(); }
  File open(const char* path, const char* mode) {
    assert(std::string(path) == "/cfg.json" && std::string(mode) == "r");
    ++persistedReads;
    return persistedConfig.empty() ? File() : File(persistedConfig);
  }
} WLED_FS;

struct AsyncWebServerRequest {
  std::map<std::string, std::string> fields;
  bool hasArg(const char* name) const { return fields.count(name); }
  String arg(const char* name) const {
    const auto found = fields.find(name);
    return found == fields.end() ? "" : found->second;
  }
  size_t args() const { return fields.size(); }
  String argName(size_t index) const {
    auto item = fields.begin();
    std::advance(item, index);
    return item->first;
  }
};
struct Print {
  std::ostringstream stream;
  template<class Value> void print(const Value& value) { stream << value; }
};

// Schedule policy is executed by castletek-schedules-policy.test.js. These
// unrelated hardware/upload fixtures retain their original isolated policy scope.
static bool castleTekWLEDValidateScheduleConfig(JsonObject) { return true; }
static bool castleTekWLEDValidateScheduleSettings(AsyncWebServerRequest*) { return true; }

// Sync validation is exercised by castletek-sync.test.js.
static bool castleTekWLEDValidateSyncSettings(AsyncWebServerRequest*) { return true; }
