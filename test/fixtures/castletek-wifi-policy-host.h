#include <algorithm>
#include <array>
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <map>
#include <string>
#include <vector>
#define LEDC_CHANNEL_MAX 8
#define LEDC_SPEED_MODE_MAX 2
#include "const.h"
#include "src/dependencies/json/ArduinoJson-v6.h"
#define F(value) value
#define WLED_AP_SSID "CastleTek-Setup"
#define WLED_AP_PASS "castletek"
#define CJSON(a,b) a = b | a
using byte = uint8_t;
using std::min; using std::max;
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& value) : std::string(value) {}
  long toInt() const { return strtol(c_str(), nullptr, 10); }
};
struct IPAddress {
  std::array<uint8_t,4> bytes;
  IPAddress(uint32_t value = 0) : bytes{uint8_t(value),uint8_t(value>>8),uint8_t(value>>16),uint8_t(value>>24)} {}
  IPAddress(uint8_t a,uint8_t b,uint8_t c,uint8_t d) : bytes{a,b,c,d} {}
  uint8_t& operator[](size_t n) { return bytes[n]; }
  uint8_t operator[](size_t n) const { return bytes[n]; }
  bool operator==(const IPAddress& other) const { return bytes == other.bytes; }
};
// PRODUCTION_WIFI_CONFIG
static std::vector<WiFiConfig> multiWiFi;
static char apSSID[33] = WLED_AP_SSID, apPass[65] = WLED_AP_PASS, cmDNS[33] = "eaves";
static byte apChannel = 6, apHide = 0, apBehavior = AP_BEHAVIOR_BOOT_NO_CONN;
static bool force802_3g = false, noWifiSleep = true, forceReconnect = false, apActive = false;
static IPAddress dnsAddress(8,8,8,8);
static int txPower = 78;
static constexpr int WIFI_POWER_2dBm = 8, WIFI_POWER_19_5dBm = 78;
struct AsyncWebServerRequest {
  std::map<std::string,std::string> fields;
  bool hasArg(const char* key) const { return fields.count(key); }
  String arg(const char* key) const { auto i=fields.find(key);return i==fields.end()?"":i->second; }
  size_t args() const { return fields.size(); }
  String argName(size_t n) const { auto i=fields.begin();std::advance(i,n);return i->first; }
};
static void getStringFromJson(char* dest, const char* src, size_t length) {
  if (src) strlcpy(dest,src,length);
}

static size_t syncWiFiResumeRequests = 0;
static void castleTekWLEDResumeWiFi() { ++syncWiFiResumeRequests; }
