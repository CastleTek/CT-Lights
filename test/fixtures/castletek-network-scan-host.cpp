static unsigned checks = 0;
static void checkAt(bool condition, int line) {
  checks++;
  if (!condition) { std::cerr << "Scan check failed at " << line << '\n'; std::abort(); }
}
#define check(value) checkAt((value), __LINE__)
static DynamicJsonDocument response(8192);
static JsonObject poll(bool refresh = false) {
  response.clear();
  JsonObject root = response.to<JsonObject>();
  castleTekWLEDSerializeNetworks(root, refresh);
  check(root["scan"]["schema"] == 1);
  check(root["networks"].is<JsonArray>());
  if (root["scan"]["state"] != "complete") check(root["networks"].size() == 0);
  return root;
}
static void done(int count, uint32_t status = 0) {
  WiFiScanClass::complete(count); // The real Arduino handler runs this first.
  castleTekWLEDNetworkScanDone(status);
}
static void reset() {
  scanState = ScanState::Idle;
  scanStateSince = 0;
  scanCompletionStatus.store(scanPending);
  scanCompletionCount.store(0);
  scanCompletionBaseline = 0;
  awaitingStoppedScan = false;
  clockNow = 100;
  WiFiGenericClass::bits = 0;
  WiFiGenericClass::onStatusRead = nullptr;
  WiFiGenericClass::returnStatusAfterHook = false;
  duringNativeStart = nullptr;
  startCalls = stopCalls = deleteCalls = enableCalls = 0;
  nativeStartResult = ESP_OK;
  nativeStopResult = ESP_OK;
  nativeCount = WIFI_SCAN_FAILED;
  staEnabled = true;
}
int main() {
  reset();
  check(poll()["scan"]["state"] == "running");
  check(startCalls == 1 && enableCalls == 1);
  check(!lastNativeConfig.ssid && !lastNativeConfig.bssid);
  check(lastNativeConfig.channel == 0 && !lastNativeConfig.show_hidden);
  check(lastNativeConfig.scan_type == WIFI_SCAN_TYPE_ACTIVE);
  check(lastNativeConfig.scan_time.active.min == 0 && lastNativeConfig.scan_time.active.max == 120);
  check(lastNativeConfig.home_chan_dwell_time == 30);
  for (unsigned i = 0; i < 3; i++) check(poll(i % 2)["scan"]["state"] == "running");
  check(startCalls == 1); // Explicit refresh also joins the active scan.
  done(1);
  JsonObject completed = poll(true);
  check(completed["scan"]["state"] == "complete" && completed["networks"].size() == 1);
  check(completed["networks"][0]["ssid"] == "House WiFi");
  check(completed["networks"][0]["channel"] == 6 && completed["networks"][0]["enc"] == 3);
  check(completed["networks"][0]["rssi"] == -45 && completed["networks"][0]["bssid"] == "01:02:03:04:05:06");
  const unsigned deletesAfterStart = deleteCalls;
  clockNow += 29999;
  check(poll()["scan"]["state"] == "complete");
  check(startCalls == 1 && deleteCalls == deletesAfterStart); // No trailing radio scan.
  clockNow++;
  check(poll()["scan"]["state"] == "running" && startCalls == 2);
  done(0);
  check(poll()["scan"]["state"] == "complete");
  check(response["networks"].size() == 0); // A true empty scan is terminal.
  check(poll()["scan"]["state"] == "complete" && startCalls == 2);
  check(poll(true)["scan"]["state"] == "running" && startCalls == 3);
  done(2, 1); // SDK asynchronous failure cannot masquerade as an empty success.
  check(poll()["scan"]["state"] == "failed");
  check(poll()["scan"]["state"] == "failed" && startCalls == 3);

  reset(); nativeStartResult = -123;
  check(poll()["scan"]["state"] == "failed");
  check(!(WiFiGenericClass::getStatusBits() & WIFI_SCANNING_BIT));
  check(poll()["scan"]["state"] == "failed" && startCalls == 1);
  nativeStartResult = ESP_OK;
  nativeStopResult = ESP_OK;
  check(poll(true)["scan"]["state"] == "running" && startCalls == 2);
  reset(); staEnabled = false;
  check(poll()["scan"]["state"] == "failed" && startCalls == 0);
  staEnabled = true; clockNow += 30000;
  check(poll()["scan"]["state"] == "running" && startCalls == 1);

  reset(); check(poll()["scan"]["state"] == "running");
  clockNow += 9999;
  check(poll(true)["scan"]["state"] == "running" && stopCalls == 0);
  clockNow++;
  check(poll()["scan"]["state"] == "failed" && stopCalls == 1);
  check(poll()["scan"]["state"] == "failed" && startCalls == 1);
  check(poll(true)["scan"]["state"] == "failed" && startCalls == 1);
  clockNow += 31000;
  check(poll()["scan"]["state"] == "failed" && startCalls == 1); // TTL cannot bypass the stop barrier.
  done(1); // The old completion only releases the barrier; its results stay failed.
  check(poll()["scan"]["state"] == "running" && startCalls == 2); // Expired cache requests a fresh scan.
  check(poll(true)["scan"]["state"] == "running");
  check(poll()["scan"]["state"] == "running"); // Old callback belongs to the previous counter.
  done(1); check(poll()["scan"]["state"] == "complete");
  WiFi.scanDelete();
  check(poll()["scan"]["state"] == "failed"); // Shared-cache replacement is explicit.

  reset(); clockNow = UINT32_MAX - 100;
  check(poll()["scan"]["state"] == "running");
  done(1); check(poll()["scan"]["state"] == "complete");
  clockNow += 29999; check(poll()["scan"]["state"] == "complete");
  clockNow++; check(poll()["scan"]["state"] == "running");
  reset(); clockNow = UINT32_MAX - 100;
  check(poll()["scan"]["state"] == "running");
  clockNow += 10000; check(poll()["scan"]["state"] == "failed");

  reset(); castleTekWLEDNetworkScanDone(0); // An older completion must not finish a newly joined scan.
  WiFiGenericClass::bits |= WIFI_SCANNING_BIT;
  check(poll(true)["scan"]["state"] == "running" && startCalls == 0 && deleteCalls == 0);
  WiFiScanClass::complete(1);
  check(poll()["scan"]["state"] == "running"); // Wait for SDK status publication too.
  castleTekWLEDNetworkScanDone(0);
  check(poll()["scan"]["state"] == "complete");
  reset(); WiFiGenericClass::bits |= WIFI_SCANNING_BIT;
  WiFiGenericClass::onStatusRead = [] { done(1); };
  check(poll(true)["scan"]["state"] == "running" && startCalls == 0);
  check(poll()["scan"]["state"] == "complete"); // Completion concurrent with joining is not lost.
  reset(); duringNativeStart = [] { done(0); };
  check(poll()["scan"]["state"] == "running");
  check(poll()["scan"]["state"] == "complete"); // Even immediate completion is published after flags are ready.
  // Prior scan completes before the active-bit read returns its new value.
  reset(); WiFiGenericClass::bits |= WIFI_SCANNING_BIT;
  WiFiGenericClass::returnStatusAfterHook = true;
  WiFiGenericClass::onStatusRead = [] { done(1); };
  check(poll(true)["scan"]["state"] == "running" && startCalls == 1);
  check(poll()["scan"]["state"] == "running");
  done(2); check(poll()["scan"]["state"] == "complete");
  check(response["networks"].size() == 2);

  // Arduino completed the previous scan, but its app callback arrives only
  // after a new native scan starts. That old status cannot fail the new scan.
  reset(); WiFiScanClass::complete(1);
  duringNativeStart = [] { castleTekWLEDNetworkScanDone(0); };
  check(poll(true)["scan"]["state"] == "running");
  duringNativeStart = nullptr;
  check(poll()["scan"]["state"] == "running");
  done(0, 1); check(poll()["scan"]["state"] == "failed");

  reset(); duringNativeStart = [] {
    castleTekWLEDNetworkScanDone(1); // delayed prior callback
    done(2); // immediate new completion must remain visible too
  };
  check(poll()["scan"]["state"] == "running");
  check(poll()["scan"]["state"] == "complete");
  check(response["networks"].size() == 2);

  // Old callbacks cannot renew the deadline. Exercise Arduino's own timeout
  // clearing the active bit before the helper stops the native scan.
  reset(); check(poll()["scan"]["state"] == "running");
  clockNow += 10001; castleTekWLEDNetworkScanDone(0);
  check(poll()["scan"]["state"] == "failed" && stopCalls == 1);
  check(awaitingStoppedScan);
  reset(); check(poll()["scan"]["state"] == "running");
  clockNow += 10000; castleTekWLEDNetworkScanDone(0);
  check(poll()["scan"]["state"] == "failed" && stopCalls == 1);

  for (int error : {ESP_ERR_WIFI_NOT_INIT, ESP_ERR_WIFI_NOT_STARTED}) {
    reset(); check(poll()["scan"]["state"] == "running");
    nativeStopResult = error; clockNow += 10000;
    check(poll()["scan"]["state"] == "failed" && stopCalls == 1);
    check(!awaitingStoppedScan);
    check(!(WiFiGenericClass::getStatusBits() & (WIFI_SCANNING_BIT | WIFI_SCAN_DONE_BIT)));
    nativeStopResult = ESP_OK;
    check(poll(true)["scan"]["state"] == "running" && startCalls == 2); // No callback required from absent driver.
    done(1); check(poll()["scan"]["state"] == "complete");
  }
  std::cout << "scan checks passed: " << checks << '\n';
}
