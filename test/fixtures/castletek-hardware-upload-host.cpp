static unsigned checks = 0;
static void check(bool condition, const char* message) {
  ++checks;
  if (!condition) {
    std::cerr << "Failed upload check " << checks << ": " << message << '\n';
    std::abort();
  }
}

static const std::string originalConfig = R"({"existing":"configuration"})";
static const std::string validConfig = R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},
  "id": {"name": "Eaves", "sui": false},
  "hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led": {"ct-policy":2,"ins": [{"type":22,"pin":[16],"start":0,"len":300,"enabled":true,"future":{"retain":true}},{"type":22,"pin":[3],"start":300,"len":1,"enabled":false},{"type":22,"pin":[1],"start":301,"len":1,"enabled":false},{"type":22,"pin":[4],"start":302,"len":1,"enabled":false}]}},
  "future": [17, "preserve unknown settings"], "nightlight": {"dur": 42}
})";

static void reset() {
  WLED_FS.files.clear();
  WLED_FS.openedForWrite.clear();
  WLED_FS.beforeRename = nullptr;
  WLED_FS.renames = 0;
  WLED_FS.seed("/cfg.json", originalConfig);
  WLED_FS.seed("/presets.json", R"({"existing":"preset"})");
  failWrite = failOpenWrite = failOpenRead = failRename = false;
  jsonLockAvailable = correctPIN = true;
  simplifiedUI = false;
  installedUsermods = defaultUsermods;
  multiWiFi = {0};
  castleTekWLEDApplyWiFiDefaults();
  irApplyToAllSelected = true;
  i2c_sda = 21; i2c_scl = 22;
  spi_mosi = 23; spi_sclk = 18; spi_miso = 19;
  castleTekWLEDSetBackupFailed(false);
  jsonLocked = false;
  jsonLockReleases = 0;
  presetUploadStatus = 0;
  doReboot.value = false;
  doReboot.requests = 0;
  presetsModifiedTime = cacheInvalidate = fsInfoUpdates = customPaletteLoads = 0;
  configNeedsWrite = false;
  securitySerializations = configBackups = configSerializations = 0;
}
static void part(AsyncWebServerRequest& request, const std::string& bytes, size_t index = 0,
                 bool final = true, const char* name = "cfg.json") {
  std::vector<uint8_t> data(bytes.begin(), bytes.end());
  handleUpload(&request, name, index, data.data(), data.size(), final);
}
static void cleaned(const AsyncWebServerRequest& request) {
  check(request._tempObject == nullptr && !request._tempFile, "request resources released");
  for (const auto& file : WLED_FS.files)
    check(file.first.find("/.ct-upload-") != 0, "staging file removed");
  check(!jsonLocked, "JSON lock released");
}
static void unchanged() {
  check(WLED_FS.bytes("/cfg.json") == originalConfig, "active configuration preserved");
  check(WLED_FS.renames == 0 && !doReboot && doReboot.requests == 0, "no install or reboot");
  check(cacheInvalidate == 0 && fsInfoUpdates == 0, "no success side effects");
  check(i2c_sda == 21 && i2c_scl == 22 && spi_mosi == 23 && spi_sclk == 18 && spi_miso == 19,
        "installed shared interface pins unchanged");
}
static void rejectedConfig(const std::string& bytes) {
  reset();
  AsyncWebServerRequest request;
  part(request, bytes);
  unchanged();
  castleTekWLEDCompleteUpload(&request);
  check(request.responses == std::vector<int>{400}, "invalid restore rejected once");
  unchanged();
  cleaned(request);
  request.disconnect();
  cleaned(request);
}

int main() {
  reset();
  AsyncWebServerRequest valid;
  const auto midpoint = validConfig.size() / 2;
  part(valid, validConfig.substr(0, midpoint), 0, false);
  unchanged();
  check(valid.responses.empty(), "partial file has no response");
  part(valid, validConfig.substr(midpoint), midpoint);
  unchanged();
  check(valid.responses.empty(), "final file chunk waits for HTTP completion");
  check(WLED_FS.bytes(castleTekWLEDTemporaryUpload(&valid)) == validConfig, "all staged bytes retained");
  castleTekWLEDCompleteUpload(&valid);
  check(valid.responses == std::vector<int>{200}, "complete valid restore accepted");
  check(WLED_FS.bytes("/cfg.json") == validConfig, "unknown keys and exact formatting preserved");
  check(WLED_FS.renames == 1 && doReboot && doReboot.requests == 1, "one atomic install and reboot request");
  check(cacheInvalidate == 1 && fsInfoUpdates == 1 && jsonLockReleases == 1, "one success update and lock release");
  cleaned(valid);
  valid.disconnect();
  cleaned(valid);
  check(WLED_FS.bytes("/cfg.json") == validConfig && WLED_FS.renames == 1 && doReboot.requests == 1,
        "disconnect after success cannot remove installed file or repeat reboot");

  for (const char* invalid : {
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[18]}]}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]},"ir":{"pin":18}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]},"ir":{"type":8}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]},"btn":{"ins":[]}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"id":{"sui":true},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]}}})",
    R"({"hw":{"led":)",
    R"({"hw":{"led":{"ins":[]}}} {"another":"document"})",
    R"({"hw":{"led":{"ins":[]}}} trailing)",
    R"({"hw":{"led":{"ins":[]}}} null)",
    R"({"id":{"name":"Missing outputs"}})",
    "[]", "null", ""
  }) rejectedConfig(invalid);
  for (const char* trailing : {" {\"another\":\"document\"}", " trailing", " null"})
    rejectedConfig(validConfig + trailing);

  // Exercise each hidden-field change as both an immediate configuration restore
  // and an uploaded automatic-recovery backup. All other values are valid.
  for (int change = 0; change < 13; ++change) {
    for (const char* target : {"cfg.json", "bkp.cfg.json"}) {
      reset();
      const std::string previousBackup = R"({"previous":"untouched recovery config"})";
      WLED_FS.seed("/bkp.cfg.json", previousBackup);
      DynamicJsonDocument modified(8192);
      check(!deserializeJson(modified, validConfig), "parse valid baseline for isolated negative case");
      switch (change) {
        case 0: modified.remove("um"); break;
        case 1: modified["um"] = nullptr; break;
        case 2: modified["um"].remove("Future"); break;
        case 3: modified["um"]["AudioReactive"]["enabled"] = false; break;
        case 4: modified["um"]["AudioReactive"]["gain"] = 11; break;
        case 5: modified["um"]["AudioReactive"]["pins"][0] = 5; break;
        case 6: modified["hw"].remove("if"); break;
        case 7: modified["hw"]["if"].remove("i2c-pin"); break;
        case 8: modified["hw"]["if"]["i2c-pin"][0] = 22; break;
        case 9: modified["hw"]["if"]["i2c-pin"] = nullptr; break;
        case 10: modified["hw"]["if"].remove("spi-pin"); break;
        case 11: modified["hw"]["if"]["spi-pin"][1] = 19; break;
        case 12: modified["hw"]["if"]["spi-pin"] = nullptr; break;
      }
      std::string rejected;
      serializeJson(modified, rejected);
      AsyncWebServerRequest hiddenSettings;
      part(hiddenSettings, rejected, 0, true, target);
      unchanged();
      check(WLED_FS.bytes("/bkp.cfg.json") == previousBackup, "staged request leaves recovery backup untouched");
      castleTekWLEDCompleteUpload(&hiddenSettings);
      check(hiddenSettings.responses == std::vector<int>{400}, "hidden usermod or interface change rejected once");
      unchanged();
      check(WLED_FS.bytes("/bkp.cfg.json") == previousBackup, "rejected hidden-field change preserves recovery backup");
      check(WLED_FS.bytes("/presets.json") == R"({"existing":"preset"})", "rejected restore preserves presets");
      cleaned(hiddenSettings);
      hiddenSettings.disconnect();
      cleaned(hiddenSettings);
      unchanged();
    }
  }

  // Raw downloads remain restorable after setup normalizes runtime fields and
  // while the installed file retains obsolete/unknown usermod keys.
  for (const char* target : {"cfg.json", "bkp.cfg.json"}) {
    for (int change = -1; change < 5; ++change) {
      reset();
      DynamicJsonDocument installed(8192);
      check(!deserializeJson(installed, validConfig), "parse installed normalization baseline");
      installed["um"]["AudioReactive"]["obsolete"] = 7;
      installed["um"]["Retired"]["keep"] = true;
      std::string installedBytes;
      serializeJson(installed, installedBytes);
      WLED_FS.seed("/cfg.json", installedBytes);
      const std::string previousBackup = R"({"previous":"untouched recovery config"})";
      WLED_FS.seed("/bkp.cfg.json", previousBackup);
      installedUsermods = R"({"AudioReactive":{"enabled":false,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}})";
      i2c_sda = i2c_scl = spi_mosi = spi_sclk = spi_miso = -1; // unavailable at setup
      switch (change) {
        case 0: installed["um"]["AudioReactive"]["obsolete"] = 8; break;
        case 1: installed["um"]["Retired"]["keep"] = false; break;
        case 2: installed["um"]["Added"]["enabled"] = true; break;
        case 3: installed["hw"]["if"]["i2c-pin"][1] = 23; break;
        case 4: installed["hw"]["if"]["spi-pin"][1] = 22; break;
      }
      std::string incoming;
      serializeJson(installed, incoming);
      AsyncWebServerRequest normalized;
      part(normalized, incoming, 0, true, target);
      check(WLED_FS.bytes("/cfg.json") == installedBytes && WLED_FS.bytes("/bkp.cfg.json") == previousBackup,
            "staged normalized restore leaves both baselines unchanged");
      castleTekWLEDCompleteUpload(&normalized);
      check(normalized.responses == std::vector<int>{change < 0 ? 200 : 400},
            "exact persisted settings accepted while modified settings rejected");
      if (change < 0) {
        check(WLED_FS.bytes(std::string("/") + target) == installedBytes,
              "unchanged raw download restored without dropping obsolete or unknown keys");
        const bool active = std::string(target) == "cfg.json";
        check(WLED_FS.renames == 1 && doReboot.requests == unsigned(active),
              "one install and only active restore requests reboot");
      } else {
        check(WLED_FS.bytes("/cfg.json") == installedBytes && WLED_FS.bytes("/bkp.cfg.json") == previousBackup,
              "rejected persisted-field changes preserve active config and backup");
        check(WLED_FS.renames == 0 && doReboot.requests == 0 && cacheInvalidate == 0 && fsInfoUpdates == 0,
              "rejected persisted-field changes have no install or success side effects");
      }
      check(i2c_sda == -1 && i2c_scl == -1 && spi_mosi == -1 && spi_sclk == -1 && spi_miso == -1,
            "upload preflight never applies normalized pins at runtime");
      cleaned(normalized);
      normalized.disconnect();
      cleaned(normalized);
    }
  }

  // AP defaults and station-slot limits apply to immediate, recovery and secret
  // configuration imports. Secret imports do not need LED/usermod sections.
  for (const char* target : {"cfg.json", "bkp.cfg.json", "wsec.json", "bkp.wsec.json"}) {
    const bool security = std::string(target).find("wsec") != std::string::npos;
    for (int change = -1; change < 10; ++change) {
      reset();
      WLED_FS.seed("/bkp.cfg.json", R"({"previous":"recovery"})");
      WLED_FS.seed("/wsec.json", R"({"previous":"private configuration"})");
      WLED_FS.seed("/bkp.wsec.json", R"({"previous":"private recovery"})");
      std::map<std::string,std::string> before;
      for (const char* file : {"/cfg.json", "/bkp.cfg.json", "/wsec.json", "/bkp.wsec.json", "/presets.json"}) before[file] = WLED_FS.bytes(file);
      DynamicJsonDocument proposed(8192);
      check(!deserializeJson(proposed, security ? std::string(R"({"nw":{"ins":[{"psk":"fixture-station-secret"}]},"pin":"1234","future":{"preserve":true}})") : validConfig),
            "parse independent config or secret baseline");
      switch (change) {
        case 0: proposed["ap"]["ssid"] = "Changed AP"; break;
        case 1: proposed["ap"]["psk"] = ""; break;
        case 2: proposed["ap"]["chan"] = 11; break;
        case 3: proposed["ap"]["hide"] = 1; break;
        case 4: proposed["ap"]["behav"] = 3; break;
        case 5: proposed["wifi"]["phy"] = true; break;
        case 6: proposed["nw"]["ins"][0]["ssid"] = "Home"; proposed["nw"]["ins"][1]["ssid"] = "Added"; break;
        case 7: proposed["nw"]["ins"][0]["psk"] = "existing-secret"; proposed["nw"]["ins"][1]["psk"] = "new-slot-secret"; break;
        case 8: proposed["nw"]["ins"] = nullptr; break;
        case 9: proposed.set(nullptr); break;
      }
      std::string bytes;serializeJson(proposed,bytes);
      AsyncWebServerRequest fixedWiFi;
      part(fixedWiFi,bytes,0,true,target);
      castleTekWLEDCompleteUpload(&fixedWiFi);
      check(fixedWiFi.responses == std::vector<int>{change < 0 ? 200 : 400}, "fixed WiFi policy applies before every configuration install");
      if (change < 0) {
        check(WLED_FS.bytes(std::string("/")+target) == bytes, "accepted config preserves all unrelated fields and exact bytes");
        check(WLED_FS.renames == 1 && doReboot.requests == unsigned(std::string(target)=="cfg.json"), "existing per-file install/reboot behavior retained");
      } else {
        for (const auto& file : before) check(WLED_FS.bytes(file.first) == file.second, "rejected WiFi change preserves every active and recovery file");
        unchanged();
      }
      check(multiWiFi.size()==1 && strcmp(apSSID,WLED_AP_SSID)==0 && strcmp(apPass,WLED_AP_PASS)==0 &&
            apChannel==6 && apHide==0 && apBehavior==AP_BEHAVIOR_BOOT_NO_CONN && !force802_3g,
            "preflight leaves station slots and fixed AP runtime intact");
      cleaned(fixedWiFi);fixedWiFi.disconnect();cleaned(fixedWiFi);
    }
    reset();multiWiFi={0,1}; // Existing legacy slots remain valid in full backups.
    DynamicJsonDocument legacy(8192);
    check(!deserializeJson(legacy, security ? std::string("{}") : validConfig), "parse legacy profile baseline");
    legacy["nw"]["ins"][0]["ssid"]="Home";legacy["nw"]["ins"][1]["ssid"]="Legacy";
    legacy["ap"]["ssid"]=WLED_AP_SSID;legacy["ap"]["psk"]=WLED_AP_PASS;legacy["ap"]["chan"]=6;
    legacy["ap"]["hide"]=0;legacy["ap"]["behav"]=AP_BEHAVIOR_BOOT_NO_CONN;legacy["wifi"]["phy"]=false;
    std::string bytes;serializeJson(legacy,bytes);
    AsyncWebServerRequest retained;part(retained,bytes,0,true,target);castleTekWLEDCompleteUpload(&retained);
    check(retained.responses==std::vector<int>{200} && multiWiFi.size()==2, "legacy profiles accepted without truncation or addition");
    check(WLED_FS.bytes(std::string("/")+target)==bytes, "legacy backup retains unrelated credentials and config bytes");cleaned(retained);
  }
  for (const char* alias : {"WSEC.JSON", "bkp.Wsec.json"}) {
    reset();AsyncWebServerRequest request;part(request,"{}",0,true,alias);castleTekWLEDCompleteUpload(&request);
    check(request.responses==std::vector<int>{400}, "alternate secret configuration spelling cannot bypass policy");unchanged();cleaned(request);
  }

  reset();
  AsyncWebServerRequest whitespace;
  part(whitespace, validConfig + " \n\t\r");
  castleTekWLEDCompleteUpload(&whitespace);
  check(whitespace.responses == std::vector<int>{200}, "JSON trailing whitespace accepted");
  check(WLED_FS.bytes("/cfg.json") == validConfig + " \n\t\r", "trailing whitespace preserved");
  cleaned(whitespace);

  for (bool frozenUI : {false, true}) {
    reset();
    simplifiedUI = frozenUI;
    irApplyToAllSelected = frozenUI;
    AsyncWebServerRequest omission;
    part(omission, R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]}}})");
    castleTekWLEDCompleteUpload(&omission);
    check(omission.responses == std::vector<int>{400}, "restore cannot reset omitted nondefault protected state");
    unchanged();
    cleaned(omission);
  }
  reset();
  simplifiedUI = true;
  irApplyToAllSelected = false;
  AsyncWebServerRequest preserved;
  const std::string nondefaultConfig = R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"id":{"sui":true},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"ir":{"sel":false},"led":{"ct-policy":2,"ins":[{"type":22,"pin":[16],"start":0,"len":300,"enabled":true},{"type":22,"pin":[3],"start":300,"len":1,"enabled":false},{"type":22,"pin":[1],"start":301,"len":1,"enabled":false},{"type":22,"pin":[4],"start":302,"len":1,"enabled":false}]}}})";
  part(preserved, nondefaultConfig);
  castleTekWLEDCompleteUpload(&preserved);
  check(preserved.responses == std::vector<int>{200}, "unchanged nondefault protected values accepted");
  check(WLED_FS.bytes("/cfg.json") == nondefaultConfig, "nondefault protected values preserved");
  cleaned(preserved);

  reset();
  AsyncWebServerRequest incomplete;
  part(incomplete, validConfig, 0, false);
  castleTekWLEDCompleteUpload(&incomplete);
  check(incomplete.responses == std::vector<int>{400}, "incomplete upload rejected");
  unchanged();
  cleaned(incomplete);

  reset();
  AsyncWebServerRequest noFile;
  castleTekWLEDCompleteUpload(&noFile);
  check(noFile.responses == std::vector<int>{400}, "missing file rejected");
  unchanged();
  cleaned(noFile);

  for (const char* secondFile : {"cfg.json", "presets.json", "ir.json"}) {
    reset();
    AsyncWebServerRequest duplicate;
    part(duplicate, validConfig);
    part(duplicate, R"({"second":"file"})", 0, true, secondFile);
    castleTekWLEDCompleteUpload(&duplicate);
    check(duplicate.responses == std::vector<int>{400}, "second multipart file rejected before installing first");
    check(WLED_FS.bytes("/presets.json") == R"({"existing":"preset"})", "second file unchanged");
    unchanged();
    cleaned(duplicate);
  }

  for (int failure = 0; failure < 5; ++failure) {
    reset();
    AsyncWebServerRequest failed;
    failWrite = failure == 0;
    failOpenWrite = failure == 1;
    failRename = failure == 2;
    failOpenRead = failure == 3;
    jsonLockAvailable = failure != 4;
    part(failed, validConfig);
    castleTekWLEDCompleteUpload(&failed);
    const int expected = failure <= 2 ? 500 : 400;
    check(failed.responses == std::vector<int>{expected}, "I/O or JSON lock failure reported");
    unchanged();
    cleaned(failed);
  }

  for (bool final : {false, true}) {
    reset();
    AsyncWebServerRequest disconnected;
    part(disconnected, validConfig, 0, final);
    disconnected.disconnect();
    check(disconnected.responses.empty(), "disconnect before request completion has no response");
    unchanged();
    cleaned(disconnected);
  }

  for (const char* filename : {"ir.json", "IR.JSON", "cfg.prepolicy.json", "cfg.preoutputs.json", "CFG.JSON", ".ct-upload-123",
                               "../cfg.json", "folder/../cfg.json", "folder\\cfg.json", "%63fg.json"}) {
    reset();
    AsyncWebServerRequest protectedPath;
    part(protectedPath, validConfig, 0, true, filename);
    castleTekWLEDCompleteUpload(&protectedPath);
    check(protectedPath.responses == std::vector<int>{400}, "protected or ambiguous upload path rejected");
    unchanged();
    cleaned(protectedPath);
  }

  reset();
  AsyncWebServerRequest unauthorized;
  correctPIN = false;
  part(unauthorized, validConfig);
  castleTekWLEDCompleteUpload(&unauthorized);
  check(unauthorized.responses == std::vector<int>{401}, "locked controller rejects upload");
  unchanged();
  cleaned(unauthorized);

  reset();
  castleTekWLEDSetBackupFailed(true);
  AsyncWebServerRequest backupFailed;
  part(backupFailed, validConfig);
  castleTekWLEDCompleteUpload(&backupFailed);
  check(backupFailed.responses == std::vector<int>{400}, "failed migration backup prevents configuration replacement");
  unchanged();
  cleaned(backupFailed);

  reset();
  AsyncWebServerRequest preset;
  const std::string presetBytes = R"({"1":{"n":"Evening","seg":[{"col":[[255,120,20]]}]},"future":"retained"})";
  part(preset, presetBytes, 0, true, "presets.json");
  check(WLED_FS.bytes("/presets.json") == R"({"existing":"preset"})", "preset also waits for request completion");
  castleTekWLEDCompleteUpload(&preset);
  check(preset.responses == std::vector<int>{200}, "ordinary preset upload accepted");
  check(WLED_FS.bytes("/presets.json") == presetBytes, "preset bytes preserved");
  check(WLED_FS.bytes("/cfg.json") == originalConfig, "preset does not change configuration");
  check(!doReboot && doReboot.requests == 0 && WLED_FS.renames == 1, "preset installed without reboot");
  check(presetsModifiedTime == 1234 && cacheInvalidate == 1 && fsInfoUpdates == 1, "preset refresh behavior retained");
  cleaned(preset);

  reset();
  AsyncWebServerRequest busyPreset;
  part(busyPreset, presetBytes, 0, true, "presets.json");
  presetUploadStatus = 409;
  castleTekWLEDCompleteUpload(&busyPreset);
  check(busyPreset.responses == std::vector<int>{409}, "busy preset file rejects upload before installation");
  check(WLED_FS.bytes("/presets.json") == R"({"existing":"preset"})" && WLED_FS.renames == 0, "busy upload preserves active presets");
  cleaned(busyPreset);


  // WLED may later promote this file during automatic boot recovery, so it
  // requires the same restore validation even though uploading it does not reboot.
  const std::string previousBackup = R"({"previous":"untouched recovery config"})";
  reset();
  WLED_FS.seed("/bkp.cfg.json", previousBackup);
  AsyncWebServerRequest recovery;
  part(recovery, validConfig.substr(0, midpoint), 0, false, "bkp.cfg.json");
  check(WLED_FS.bytes("/bkp.cfg.json") == previousBackup, "partial recovery upload preserves previous backup");
  part(recovery, validConfig.substr(midpoint), midpoint, true, "bkp.cfg.json");
  unchanged();
  check(WLED_FS.bytes("/bkp.cfg.json") == previousBackup && recovery.responses.empty(),
        "recovery file waits for complete HTTP callback");
  castleTekWLEDCompleteUpload(&recovery);
  check(recovery.responses == std::vector<int>{200}, "valid automatic-recovery backup accepted");
  check(WLED_FS.bytes("/bkp.cfg.json") == validConfig && WLED_FS.bytes("/cfg.json") == originalConfig,
        "recovery upload preserves exact backup bytes and active config");
  check(WLED_FS.renames == 1 && !doReboot && doReboot.requests == 0,
        "recovery backup installed atomically without reboot");
  check(cacheInvalidate == 1 && fsInfoUpdates == 1 && jsonLockReleases == 1,
        "recovery backup validated and refreshed once");
  cleaned(recovery);

  struct BackupUploadCase {
    const char* bytes;
    bool currentUI = false;
    bool sharedSelection = true;
    bool complete = true;
    bool backupFailure = false;
    const char* filename = "bkp.cfg.json";
  };
  for (const auto& example : std::vector<BackupUploadCase>{
    {R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[18]}]}}})"},
    {R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]},"ir":{"pin":18}}})"},
    {R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]},"ir":{"type":8}}})"},
    {R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"id":{"sui":true},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]}}})"},
    {R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]},"ir":{"sel":false}}})"},
    {validConfig.c_str(), false, false}, // omitted selection cannot reset a nondefault installed value
    {R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"installed"}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":[{"type":22,"pin":[16]}]}}})", true}, // omitted UI value
    {R"({"hw":{"led":)"},
    {R"({"hw":{"led":{"ins":[]}}} {"trailing":"object"})"},
    {validConfig.c_str(), false, true, false}, // complete JSON but incomplete multipart stream
    {validConfig.c_str(), false, true, true, true}, // original migration backup could not be retained
    {validConfig.c_str(), false, true, true, false, "BKP.CFG.JSON"},
    {validConfig.c_str(), false, true, true, false, "/bkp.Cfg.json"}
  }) {
    reset();
    WLED_FS.seed("/bkp.cfg.json", previousBackup);
    simplifiedUI = example.currentUI;
    irApplyToAllSelected = example.sharedSelection;
    castleTekWLEDSetBackupFailed(example.backupFailure);
    AsyncWebServerRequest rejectedRecovery;
    part(rejectedRecovery, example.bytes, 0, example.complete, example.filename);
    castleTekWLEDCompleteUpload(&rejectedRecovery);
    check(rejectedRecovery.responses == std::vector<int>{400}, "unsafe or incomplete recovery backup rejected");
    check(WLED_FS.bytes("/bkp.cfg.json") == previousBackup, "rejected recovery upload preserves previous backup");
    unchanged();
    cleaned(rejectedRecovery);
  }

  reset();
  WLED_FS.seed("/cfg.json", validConfig);
  bool observedAtomicBackup = false;
  WLED_FS.beforeRename = [&](const String& source, const String& destination) {
    check(source == "/.ct-upload-prepolicy" && destination == "/cfg.prepolicy.json", "backup installs only from temporary path");
    check(!WLED_FS.exists(destination), "completed backup is invisible before atomic rename");
    check(WLED_FS.bytes(source) == validConfig, "all source bytes copied before rename");
    observedAtomicBackup = true;
  };
  hostRetainPrepolicy(true);
  WLED_FS.beforeRename = nullptr;
  check(observedAtomicBackup && WLED_FS.renames == 1, "one atomic backup installation");
  check(WLED_FS.bytes("/cfg.json") == validConfig && WLED_FS.bytes("/cfg.prepolicy.json") == validConfig,
        "migration source and unknown bytes preserved exactly");
  check(!WLED_FS.exists("/.ct-upload-prepolicy") && !castleTekWLEDBackupFailed(), "successful migration cleans temporary path without failure flag");
  check(WLED_FS.openedForWrite == std::vector<std::string>{"/.ct-upload-prepolicy"}, "backup never opens source or destination for truncation");
  const auto firstBackup = WLED_FS.bytes("/cfg.prepolicy.json");
  WLED_FS.seed("/cfg.json", originalConfig);
  hostRetainPrepolicy(true);
  check(WLED_FS.bytes("/cfg.prepolicy.json") == firstBackup && WLED_FS.renames == 2 && WLED_FS.bytes("/cfg.preoutputs.json") == originalConfig,
        "the output migration keeps its own current snapshot without replacing the older backup");

  const auto firstOutputBackup = WLED_FS.bytes("/cfg.preoutputs.json");
  WLED_FS.seed("/cfg.json", R"({"newer":"legacy settings"})");
  hostRetainPrepolicy(true);
  check(WLED_FS.bytes("/cfg.preoutputs.json") == firstOutputBackup && WLED_FS.renames == 2,
        "later legacy boots cannot replace the first output migration snapshot");

  std::string legacyOutputConfig = validConfig;
  const std::string marker = "\"ct-policy\":2,";
  legacyOutputConfig.erase(legacyOutputConfig.find(marker), marker.size());
  reset();
  WLED_FS.seed("/cfg.json", legacyOutputConfig);
  WLED_FS.seed("/cfg.prepolicy.json", "older migration snapshot");
  bool observedOutputBackup = false;
  WLED_FS.beforeRename = [&](const String& source, const String& destination) {
    check(source == "/.ct-upload-preoutputs" && destination == "/cfg.preoutputs.json", "output snapshot uses its own atomic temporary path");
    check(!WLED_FS.exists(destination) && WLED_FS.bytes(source) == legacyOutputConfig, "complete current bytes precede output backup installation");
    observedOutputBackup = true;
  };
  hostRetainPrepolicy(true);
  WLED_FS.beforeRename = nullptr;
  check(observedOutputBackup && WLED_FS.bytes("/cfg.preoutputs.json") == legacyOutputConfig, "output migration snapshot preserves the latest settings");
  check(WLED_FS.bytes("/cfg.prepolicy.json") == "older migration snapshot", "older policy recovery snapshot remains unchanged");
  for (int failure = 0; failure < 4; failure++) {
    reset();
    WLED_FS.seed("/cfg.json", legacyOutputConfig);
    WLED_FS.seed("/cfg.prepolicy.json", "older migration snapshot");
    failWrite = failure == 0;
    failOpenWrite = failure == 1;
    failOpenRead = failure == 2;
    failRename = failure == 3;
    hostRetainPrepolicy(true);
    check(castleTekWLEDBackupFailed(), "output-specific backup failure blocks configuration writes");
    check(WLED_FS.bytes("/cfg.json") == legacyOutputConfig && WLED_FS.bytes("/cfg.prepolicy.json") == "older migration snapshot", "failed output snapshot preserves both existing files");
    check(!WLED_FS.exists("/.ct-upload-preoutputs") && !WLED_FS.exists("/cfg.preoutputs.json"), "failed output snapshot leaves no partial recovery copy");
  }

  reset();
  hostRetainPrepolicy(false);
  check(!castleTekWLEDBackupFailed() && WLED_FS.openedForWrite.empty() && WLED_FS.renames == 0,
        "failed configuration read does not create a misleading backup");

  for (int failure = 0; failure < 4; ++failure) {
    reset();
    WLED_FS.seed("/cfg.json", validConfig);
    failWrite = failure == 0;
    failOpenWrite = failure == 1;
    failOpenRead = failure == 2;
    failRename = failure == 3;
    hostRetainPrepolicy(true);
    check(castleTekWLEDBackupFailed(), "copy or rename failure recorded");
    check(WLED_FS.bytes("/cfg.json") == validConfig && WLED_FS.renames == 0, "failed migration preserves original configuration");
    check(!WLED_FS.exists("/.ct-upload-prepolicy") && !WLED_FS.exists("/cfg.prepolicy.json"),
          "partial backup cannot become a completed backup");
    failWrite = failOpenWrite = failOpenRead = failRename = false;
    const auto previousWrites = WLED_FS.openedForWrite;
    configNeedsWrite = true;
    serializeConfigToFS();
    check(!configNeedsWrite, "blocked serializer clears pending write to prevent retry loop");
    check(WLED_FS.openedForWrite == previousWrites && WLED_FS.bytes("/cfg.json") == validConfig,
          "backup failure stops automatic config writes");
    check(securitySerializations == 0 && configBackups == 0 && configSerializations == 0 && jsonLockReleases == 0,
          "backup failure guard precedes credential writes, backup, serialization and JSON lock");
  }

  reset();
  configNeedsWrite = true;
  serializeConfigToFS();
  check(!configNeedsWrite && securitySerializations == 1 && configBackups == 1 && configSerializations == 1,
        "normal serializer continues when backup is healthy");
  check(WLED_FS.bytes("/cfg.json") == R"({"serialized":true})" && jsonLockReleases == 1,
        "normal configuration file write completes");

  std::cout << "upload checks passed: " << checks << '\n';
}
