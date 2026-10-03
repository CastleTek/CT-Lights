#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "src/dependencies/json/ArduinoJson-v6.h"
#define CASTLETEK_WLED_COMPAT
#define F(text) text
#define FPSTR(text) text
#define DEBUG_PRINTLN(...)
#define WLED_MAX_TIMERS 64
#define JSON_LOCK_CFG_SER 1
#define JSON_LOCK_SETTINGS 2
#define CALL_MODE_DIRECT_CHANGE 1
#define TOKI_TS_NONE 0
using byte = uint8_t;
using PSRAMDynamicJsonDocument = DynamicJsonDocument;
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& value) : std::string(value) {}
  long toInt() const { return strtol(c_str(), nullptr, 10); }
  size_t write(uint8_t value) { push_back(char(value)); return 1; }
  size_t write(const uint8_t* bytes, size_t count) { append(reinterpret_cast<const char*>(bytes), count); return count; }
};
class Print {
public:
  std::string bytes;
  size_t write(uint8_t value) { bytes.push_back(char(value)); return 1; }
  size_t write(const uint8_t* value, size_t count) { bytes.append(reinterpret_cast<const char*>(value), count); return count; }
  void print(const char* value) { bytes += value; }
  void print(char value) { bytes += value; }
};
struct AsyncWebServerRequest {
  std::map<std::string,std::string> fields;
  bool hasArg(const char* key) const { return fields.count(key); }
  String arg(const char* key) const { auto i=fields.find(key); return i==fields.end()?"":i->second; }
};
static std::vector<int> timers;
static time_t localTime = 0, sunrise = 0, sunset = 0;
struct { int source=150; int getTimeSource() const { return source; } } toki;
static int year(time_t time) { return std::gmtime(&time)->tm_year+1900; }
static int month(time_t time) { return std::gmtime(&time)->tm_mon+1; }
static int day(time_t time) { return std::gmtime(&time)->tm_mday; }
static int hour(time_t time) { return std::gmtime(&time)->tm_hour; }
static int minute(time_t time) { return std::gmtime(&time)->tm_min; }
static void noInterrupts() {}
static void interrupts() {}
static int bri = 100, pendingPreset = -1, appliedCount = 0, toggles = 0, notifications = 0;
static void applyPreset(uint8_t value) { pendingPreset=value; ++appliedCount; }
static void toggleOnOff() { bri = bri ? 0 : 100; ++toggles; }
static void stateUpdated(int) { ++notifications; }
static bool failWrite=false, failOpen=false, failRename=false, failLock=false, backupFailed=false;
static bool configNeedsWrite=false;
static unsigned fileWrites=0, secretWrites=0, backups=0;
class File {
  std::shared_ptr<std::string> bytes;
public:
  File() = default;
  explicit File(std::shared_ptr<std::string> value): bytes(value) {}
  explicit operator bool() const { return bool(bytes); }
  size_t write(const uint8_t* data,size_t count) {
    if (!bytes) return 0;
    if (failWrite && count) --count;
    bytes->append(reinterpret_cast<const char*>(data),count); return count;
  }
  size_t write(uint8_t value) { return write(&value,1); }
  size_t size() const { return bytes?bytes->size():0; }
  void flush() {}
  void close() { bytes.reset(); }
};
struct {
  std::map<std::string,std::shared_ptr<std::string>> files;
  File open(const char* name,const char* mode) {
    assert(std::string(mode)=="w"); ++fileWrites;
    if(failOpen)return File();
    files[name]=std::make_shared<std::string>(); return File(files[name]);
  }
  bool rename(const char* from,const char* to) {
    if(failRename || !files.count(from))return false;
    files[to]=files[from];files.erase(from);return true;
  }
  bool remove(const char* name) { return files.erase(name); }
} WLED_FS;
static DynamicJsonDocument configDocument(32768);
static DynamicJsonDocument* pDoc=&configDocument;
static const char s_cfg_json[] = "/cfg.json";
static bool castleTekWLEDBackupFailed() { return backupFailed; }
static void serializeConfigSec() { ++secretWrites; }
static void backupConfig() { ++backups; }
static bool jsonLocked=false;
static std::function<void()> afterJSONUnlock;
static bool requestJSONBufferLock(int) { if(failLock || jsonLocked)return false;jsonLocked=true;return true; }
static void releaseJSONBufferLock() { assert(jsonLocked);jsonLocked=false;if(afterJSONUnlock){auto hook=afterJSONUnlock;afterJSONUnlock=nullptr;hook();} }
static void serializeConfig(JsonObject root);

// Sync persistence acknowledgement has its own runtime fixture.
static void castleTekWLEDSyncConfigSaved(bool, JsonObject) {}
