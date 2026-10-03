// In-memory adapters for the actual upload handler and vendored JSON decoder.
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>
#define LEDC_CHANNEL_MAX 8
#define LEDC_SPEED_MODE_MAX 2
#include "const.h"
#include "src/dependencies/json/ArduinoJson-v6.h"

#define F(value) value
#define FPSTR(value) value
#define HEX 16
#define DEBUG_PRINTLN(...)
#define DEBUG_PRINTF(...)
using byte = uint8_t;
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& value) : std::string(value) {}
  String(uintptr_t value, int base) {
    std::ostringstream text;
    if (base == HEX) text << std::hex;
    text << value;
    assign(text.str());
  }
  bool startsWith(const String& prefix) const { return rfind(prefix, 0) == 0; }
  bool isEmpty() const { return empty(); }
  bool equals(const String& other) const { return *this == other; }
  int indexOf(char value) const { const auto at = find(value); return at == npos ? -1 : int(at); }
  int indexOf(const char* value) const { const auto at = find(value); return at == npos ? -1 : int(at); }
  void toLowerCase() { std::transform(begin(), end(), begin(), [](unsigned char c) { return std::tolower(c); }); }
  friend String operator+(char prefix, const String& text) { return std::string(1, prefix) + static_cast<const std::string&>(text); }
};

static bool failWrite = false;
static bool failOpenWrite = false;
static bool failOpenRead = false;
static bool failRename = false;
class File {
  struct State {
    std::shared_ptr<std::string> bytes;
    size_t position = 0;
    bool open = true;
    bool writable = false;
  };
  std::shared_ptr<State> state;
public:
  File() = default;
  File(std::shared_ptr<std::string> bytes, bool writable) : state(std::make_shared<State>()) {
    state->bytes = bytes;
    state->writable = writable;
  }
  explicit operator bool() const { return state && state->open; }
  void close() { if (state) state->open = false; }
  void flush() {}
  size_t size() const { return state ? state->bytes->size() : 0; }
  size_t write(const uint8_t* data, size_t count) {
    if (!*this || !state->writable) return 0;
    const size_t accepted = failWrite && count ? count - 1 : count;
    state->bytes->append(reinterpret_cast<const char*>(data), accepted);
    return accepted;
  }
  size_t write(uint8_t value) { return write(&value, 1); }
  int available() const { return *this ? int(state->bytes->size() - state->position) : 0; }
  int read() { return available() ? static_cast<unsigned char>((*state->bytes)[state->position++]) : -1; }
  size_t read(uint8_t* destination, size_t count) { return readBytes(reinterpret_cast<char*>(destination), count); }
  size_t readBytes(char* destination, size_t count) {
    size_t readCount = 0;
    while (readCount < count && available()) destination[readCount++] = char(read());
    return readCount;
  }
};
struct MemoryFS {
  std::map<std::string, std::shared_ptr<std::string>> files;
  std::vector<std::string> openedForWrite;
  std::function<void(const String&, const String&)> beforeRename;
  unsigned renames = 0;
  void seed(const std::string& path, const std::string& bytes) { files[path] = std::make_shared<std::string>(bytes); }
  std::string bytes(const std::string& path) const { return *files.at(path); }
  bool exists(const String& path) const { return files.count(path) > 0; }
  File open(const String& path, const char* mode) {
    const bool write = std::string(mode) == "w";
    if ((write && failOpenWrite) || (!write && failOpenRead)) return File();
    if (write) { openedForWrite.push_back(path); seed(path, ""); }
    const auto found = files.find(path);
    return found == files.end() ? File() : File(found->second, write);
  }
  bool remove(const String& path) { return files.erase(path) > 0; }
  bool rename(const String& source, const String& destination) {
    if (failRename || !files.count(source)) return false;
    if (beforeRename) beforeRename(source, destination);
    const auto staged = files.at(source);
    files[destination] = staged;
    files.erase(source);
    ++renames;
    return true;
  }
} WLED_FS;

struct AsyncWebServerRequest {
  std::map<std::string, std::string> fields;
  void* _tempObject = nullptr;
  File _tempFile;
  std::function<void()> disconnected;
  std::vector<int> responses;
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
  void onDisconnect(std::function<void()> callback) { disconnected = std::move(callback); }
  void send(int status, const char*, const char*) { responses.push_back(status); }
  void disconnect() {
    if (disconnected) {
      const auto callback = std::move(disconnected);
      disconnected = nullptr;
      callback();
    }
  }
};
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
struct Button { int pin, type, macroButton, macroLongPress, macroDoublePress; };
static std::vector<Button> buttons = {{0, BTN_TYPE_PUSH, 0, 0, 0}};
static bool simplifiedUI = false;
static bool disablePullUp = false;
static int touchThreshold = 32;
static bool buttonPublishMqtt = false;
static bool irApplyToAllSelected = true;
static int i2c_sda = 21, i2c_scl = 22;
static int spi_mosi = 23, spi_sclk = 18, spi_miso = 19;
using PSRAMDynamicJsonDocument = DynamicJsonDocument;
static constexpr const char* defaultUsermods = R"({"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}})";
static const char* installedUsermods = defaultUsermods;
namespace UsermodManager {
  static void addToConfig(JsonObject& root) {
    DynamicJsonDocument current(4096);
    if (deserializeJson(current, installedUsermods)) std::abort();
    root.set(current.as<JsonObject>());
  }
}

struct Print {
  std::ostringstream stream;
  template<class Value> void print(const Value& value) { stream << value; }
};

static DynamicJsonDocument document(32768);
static DynamicJsonDocument* pDoc = &document;
static bool jsonLockAvailable = true;
static bool jsonLocked = false;
static unsigned jsonLockReleases = 0;
static bool requestJSONBufferLock(int) {
  if (!jsonLockAvailable || jsonLocked) return false;
  jsonLocked = true;
  return true;
}
static void releaseJSONBufferLock() { jsonLocked = false; ++jsonLockReleases; }
static bool correctPIN = true;
struct RebootFlag {
  bool value = false;
  unsigned requests = 0;
  RebootFlag& operator=(bool requested) { value = requested; if (requested) ++requests; return *this; }
  explicit operator bool() const { return value; }
} doReboot;
static constexpr const char* CONTENT_TYPE_PLAIN = "text/plain";
static constexpr const char* s_unlock_cfg = "Unlock settings";
static unsigned presetsModifiedTime = 0;
static unsigned cacheInvalidate = 0;
static unsigned fsInfoUpdates = 0;
static unsigned customPaletteLoads = 0;
static const char* getPresetsFileName() { return "/presets.json"; }
static void loadCustomPalettes() { ++customPaletteLoads; }
static void updateFSInfo() { ++fsInfoUpdates; }
static struct Clock { unsigned second() const { return 1234; } } toki;

// The real serializer is compiled below. These stand-ins count any work after
// its early guard, including credential serialization before the config write.
static const char* s_cfg_json = "/cfg.json";
static bool configNeedsWrite = false;
static unsigned securitySerializations = 0;
static unsigned configBackups = 0;
static unsigned configSerializations = 0;
static void serializeConfigSec() { ++securitySerializations; }
static bool backupConfig() { ++configBackups; return true; }
static void serializeConfig(JsonObject root) {
  ++configSerializations;
  root["serialized"] = true;
}

// Schedule policy is executed by castletek-schedules-policy.test.js. These
// unrelated hardware/upload fixtures retain their original isolated policy scope.
static bool castleTekWLEDValidateScheduleConfig(JsonObject) { return true; }
static bool castleTekWLEDValidateScheduleSettings(AsyncWebServerRequest*) { return true; }

static uint32_t castleTekWLEDScheduleRevision() { return 0; }
static bool castleTekWLEDScheduleConfigWritable() { return true; }
static void castleTekWLEDScheduleConfigSaved(bool, uint32_t) {}

// Sync validation is exercised by castletek-sync.test.js.
static bool castleTekWLEDValidateSyncSettings(AsyncWebServerRequest*) { return true; }
static void castleTekWLEDSyncConfigSaved(bool, JsonObject) {}

// Preset-file locking executes in castletek-preset-name.test.js; this fixture
// verifies upload dispatch and busy responses without duplicating that module.
static int presetUploadStatus = 0;
static int castleTekWLEDInstallPresetUpload(const String& temporary) {
  if (presetUploadStatus) return presetUploadStatus;
  return WLED_FS.rename(temporary, "/presets.json") ? 0 : 500;
}
