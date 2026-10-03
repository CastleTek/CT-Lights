#include <cassert>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <string>
#include "src/dependencies/json/ArduinoJson-v6.h"
static uint32_t clockNow = 100;
static uint32_t millis() { return clockNow; }
constexpr int WIFI_SCAN_RUNNING = -1, WIFI_SCAN_FAILED = -2;
constexpr uint32_t WIFI_SCANNING_BIT = 1, WIFI_SCAN_DONE_BIT = 2;
using esp_err_t = int;
constexpr int WIFI_SCAN_TYPE_ACTIVE = 0, ESP_OK = 0;
constexpr int ESP_ERR_WIFI_NOT_INIT = 0x3001, ESP_ERR_WIFI_NOT_STARTED = 0x3002;
struct wifi_scan_config_t {
  uint8_t *ssid;
  uint8_t *bssid;
  uint8_t channel;
  bool show_hidden;
  int scan_type;
  struct { struct { uint32_t min, max; } active; } scan_time;
  uint8_t home_chan_dwell_time;
};
static wifi_scan_config_t lastNativeConfig;
static unsigned startCalls = 0, stopCalls = 0, deleteCalls = 0, enableCalls = 0;
static int nativeStartResult = ESP_OK, nativeStopResult = ESP_OK;
static int nativeCount = WIFI_SCAN_FAILED;
static bool staEnabled = true;
static void (*duringNativeStart)() = nullptr;
class WiFiGenericClass {
public:
  static inline uint32_t bits = 0;
  static inline void (*onStatusRead)() = nullptr;
  static inline bool returnStatusAfterHook = false;
  static int getStatusBits() {
    const uint32_t result = bits;
    if (onStatusRead) { auto callback = onStatusRead; onStatusRead = nullptr; callback(); }
    return returnStatusAfterHook ? bits : result;
  }
protected:
  // Match the real Arduino header: only friends and derived classes can write
  // shared status bits. Friendship with WiFiScanClass is not inherited.
  friend class WiFiScanClass;
  static int setStatusBits(int value) { bits |= value; return bits; }
  static int clearStatusBits(int value) { bits &= ~value; return bits; }
};
class WiFiScanClass {
public:
  void scanDelete() { deleteCalls++; WiFiGenericClass::clearStatusBits(WIFI_SCAN_DONE_BIT); nativeCount = WIFI_SCAN_FAILED; }
  int16_t scanComplete() {
    // Mirror Arduino 2.0.17's timeout side effect, not just its status values.
    if (_scanStarted && uint32_t(millis() - _scanStarted) > _scanTimeout) {
      WiFiGenericClass::clearStatusBits(WIFI_SCANNING_BIT);
      return WIFI_SCAN_FAILED;
    }
    if (WiFiGenericClass::getStatusBits() & WIFI_SCAN_DONE_BIT) return nativeCount;
    if (WiFiGenericClass::getStatusBits() & WIFI_SCANNING_BIT) return WIFI_SCAN_RUNNING;
    return WIFI_SCAN_FAILED;
  }
  static void complete(int count) {
    nativeCount = count;
    _scanStarted = 0;
    WiFiGenericClass::setStatusBits(WIFI_SCAN_DONE_BIT);
    WiFiGenericClass::clearStatusBits(WIFI_SCANNING_BIT);
  }
protected:
  static inline bool _scanAsync = false;
  static inline uint32_t _scanStarted = 0, _scanTimeout = 0;
};
class HostWiFi : public WiFiScanClass {
public:
  bool enableSTA(bool enable) { assert(enable); enableCalls++; return staEnabled; }
  std::string SSID(int) { return "House WiFi"; }
  int RSSI(int) { return -45; }
  std::string BSSIDstr(int) { return "01:02:03:04:05:06"; }
  int channel(int) { return 6; }
  int encryptionType(int) { return 3; }
} WiFi;
static int esp_wifi_scan_start(const wifi_scan_config_t* config, bool block) {
  assert(!block);
  assert(WiFiGenericClass::getStatusBits() & WIFI_SCANNING_BIT);
  lastNativeConfig = *config;
  startCalls++;
  if (duringNativeStart) duringNativeStart();
  return nativeStartResult;
}
static int esp_wifi_scan_stop() { stopCalls++; return nativeStopResult; }
