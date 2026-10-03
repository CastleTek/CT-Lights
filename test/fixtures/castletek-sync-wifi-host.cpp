#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <initializer_list>
#define CASTLETEK_WLED_COMPAT
#define ARDUINO_ARCH_ESP32
static size_t checks = 0;
#define CHECK(value) do { ++checks; if (!(value)) { std::fprintf(stderr, "check failed line %d: %s\n", __LINE__, #value); std::abort(); } } while (false)
bool wifiConfigured = true;
#define WLED_WIFI_CONFIGURED wifiConfigured
constexpr int WL_CONNECTED = 3;
uint32_t clockNow = 100;
uint32_t millis() { return clockNow; }
bool apActive = false, forceReconnect = false;
constexpr int JSON_LOCK_SERVER = 1;
bool jsonLocked = false;
bool requestJSONBufferLock(int, int waitTicks) { CHECK(waitTicks == 0); if (jsonLocked) return false; jsonLocked = true; return true; }
void releaseJSONBufferLock() { CHECK(jsonLocked); jsonLocked = false; }
unsigned long lastReconnectAttempt = 100;
bool committedRadio = false, connectionChangeAllowed = true, scanBusy = false;
uint8_t committedChannel = 1;
size_t radioStops = 0;
bool castleTekWLEDSyncUsesOfflineAP() { return committedRadio; }
uint8_t castleTekWLEDSyncOfflineChannel() { return committedChannel; }
bool castleTekWLEDSyncConnectionChangeAllowed() { return connectionChangeAllowed; }
bool castleTekWLEDNetworkScanBusy() { return scanBusy; }
void castleTekESPNowStop() { ++radioStops; }
struct WiFiMock {
  bool connected = false, autoReconnect = true, stationEnabled = true;
  uint8_t actualChannel = 6;
  size_t disconnects = 0, apDisconnects = 0;
  int status() const { return connected ? WL_CONNECTED : 0; }
  uint8_t channel() const { return actualChannel; }
  void setAutoReconnect(bool value) { autoReconnect = value; }
  void disconnect() { connected = false; ++disconnects; }
  void enableSTA(bool value) { stationEnabled = value; }
  void softAPdisconnect(bool) { apActive = false; ++apDisconnects; }
} WiFi;
struct NetworkMock { bool ethernet = false; bool isConnected() const { return ethernet || WiFi.connected; } } Network;
struct WLED {
  size_t starts = 0;
  bool fails = false;
  static WLED& instance() { static WLED wled; return wled; }
  void initAP() { ++starts; apActive = !fails; WiFi.actualChannel = committedRadio ? committedChannel : 6; }
};
// PRODUCTION
int main() {
  auto& wled = WLED::instance();
  CHECK(!castleTekWLEDHandleSyncConnection()); CHECK(!wled.starts); // factory LAN
  committedRadio = true; WiFi.connected = true;
  clockNow = 20000; CHECK(!castleTekWLEDHandleSyncConnection()); CHECK(!wled.starts);
  committedChannel = 11; CHECK(!castleTekWLEDHandleSyncConnection()); CHECK(WiFi.channel() == 6); // router wins
  WiFi.connected = false; committedChannel = 1;
  CHECK(lastReconnectAttempt == 100); // Original boot join was long ago.
  CHECK(!castleTekWLEDHandleSyncConnection()); CHECK(lastReconnectAttempt == clockNow);
  clockNow += 11999; CHECK(!castleTekWLEDHandleSyncConnection()); CHECK(!wled.starts);
  scanBusy = true; ++clockNow; CHECK(castleTekWLEDHandleSyncConnection()); CHECK(!wled.starts);
  scanBusy = false; jsonLocked = true; apActive = true; WiFi.actualChannel = 1;
  CHECK(castleTekWLEDHandleSyncConnection()); CHECK(!wled.starts && !castleTekWLEDSyncOfflineHeld());
  jsonLocked = false; CHECK(castleTekWLEDHandleSyncConnection());
  CHECK(castleTekWLEDSyncOfflineHeld() && apActive && WiFi.channel() == 1);
  CHECK(!WiFi.autoReconnect && !WiFi.stationEnabled); CHECK(wled.starts == 1 && radioStops == 1);
  for (unsigned elapsed : {18000U, 300000U, 3600000U}) {
    clockNow += elapsed; forceReconnect = true; CHECK(castleTekWLEDHandleSyncConnection());
    CHECK(!forceReconnect && wled.starts == 1 && WiFi.channel() == 1);
  }
  // A requested scan temporarily leaves the home channel; never reset its SDK.
  scanBusy = true; WiFi.actualChannel = 9; committedChannel = 11;
  CHECK(castleTekWLEDHandleSyncConnection()); CHECK(wled.starts == 1);
  scanBusy = false; CHECK(castleTekWLEDHandleSyncConnection());
  CHECK(wled.starts == 2 && WiFi.channel() == 11 && !WiFi.autoReconnect);
  // AP failures retry at most once a second; timeout arithmetic wraps safely.
  apActive = false; wled.fails = true; CHECK(castleTekWLEDHandleSyncConnection());
  const auto failedStarts = wled.starts;
  for (int i = 0; i < 100; ++i) CHECK(castleTekWLEDHandleSyncConnection());
  CHECK(wled.starts == failedStarts); clockNow += 1000; wled.fails = false;
  CHECK(castleTekWLEDHandleSyncConnection()); CHECK(apActive);
  // HTTP requests do no SDK work. Failed persistence holds the AP unchanged.
  const auto beforeRequest = WiFi.disconnects;
  castleTekWLEDResumeWiFi(); CHECK(WiFi.disconnects == beforeRequest);
  connectionChangeAllowed = false; clockNow += 1000;
  CHECK(castleTekWLEDHandleSyncConnection()); CHECK(castleTekWLEDSyncOfflineHeld());
  connectionChangeAllowed = true; CHECK(!castleTekWLEDHandleSyncConnection());
  CHECK(forceReconnect && !castleTekWLEDSyncOfflineHeld() && WiFi.autoReconnect);
  forceReconnect = false; lastReconnectAttempt = clockNow; apActive = true;
  CHECK(!castleTekWLEDHandleSyncConnection());
  clockNow += 11999; CHECK(!castleTekWLEDHandleSyncConnection());
  CHECK(!castleTekWLEDSyncOfflineHeld()); apActive = false; lastReconnectAttempt = clockNow;
  clockNow += 12000; CHECK(castleTekWLEDHandleSyncConnection());
  // Durable LAN/radio-off selection exits hold and restores normal joining.
  committedRadio = false; CHECK(!castleTekWLEDHandleSyncConnection());
  CHECK(forceReconnect && WiFi.autoReconnect && !castleTekWLEDSyncOfflineHeld());
  // Ethernet keeps its ordinary initInterfaces() path and never enters hold.
  forceReconnect = false; committedRadio = true; Network.ethernet = true;
  CHECK(!castleTekWLEDHandleSyncConnection()); CHECK(!castleTekWLEDSyncOfflineHeld());
  Network.ethernet = false; apActive = false;
  clockNow = 0xfffff000U; lastReconnectAttempt = clockNow;
  clockNow += 12000; CHECK(castleTekWLEDHandleSyncConnection()); CHECK(castleTekWLEDSyncOfflineHeld());
  clockNow = 0xffffff00U; castleTekWLEDResumeWiFi(); clockNow += 749;
  CHECK(castleTekWLEDHandleSyncConnection()); ++clockNow;
  CHECK(!castleTekWLEDHandleSyncConnection()); CHECK(WiFi.autoReconnect);
  std::printf("CastleTek sync Wi-Fi lifecycle checks passed: %zu\n", checks);
}
