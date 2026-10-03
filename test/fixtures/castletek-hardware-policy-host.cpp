static unsigned checks = 0;
static void checkAt(bool condition, int line) {
  ++checks;
  if (!condition) {
    std::cerr << "Failed policy line " << line << ", check " << checks << '\n';
    std::abort();
  }
}
#define check(condition) checkAt((condition), __LINE__)
static bool config(const char* source) {
  DynamicJsonDocument doc(8192);
  check(!deserializeJson(doc, source));
  std::string before, after;
  serializeJson(doc, before);
  const bool allowed = castleTekWLEDValidateConfig(doc.as<JsonObject>());
  serializeJson(doc, after);
  check(before == after); // Preflight must not mutate even a rejected document.
  return allowed;
}
// Explicit fixture token keeps unrelated restore-policy cases complete under
// both four-connector compiled board profiles.
static std::string fixedRows() {
  const int pins[] = {DATA_PINS};
  std::string rows = "[";
  for (size_t i = 0; i < sizeof(pins)/sizeof(pins[0]); i++) {
    if (i) rows += ",";
    rows += "{\"type\":22,\"pin\":[" + std::to_string(pins[i]) + "],\"start\":" +
      std::to_string(i ? 9+i : 0) + ",\"len\":" + std::to_string(i ? 1 : 10) +
      ",\"enabled\":" + (i ? "false" : "true") + "}";
  }
  return rows + "]";
}
static std::string fixedFixture(const char* source) {
  std::string text(source);
  const std::string token = "\"FIXED_OUTPUTS\"";
  const size_t offset = text.find(token);
  if (offset != std::string::npos) text.replace(offset, token.size(), fixedRows());
  return text;
}
static bool restore(const char* source) {
  DynamicJsonDocument doc(8192);
  check(!deserializeJson(doc, fixedFixture(source)));
  std::string before, after;
  serializeJson(doc, before);
  const bool allowed = castleTekWLEDValidateRestore(doc.as<JsonObject>());
  serializeJson(doc, after);
  check(before == after);
  return allowed;
}
static bool form(byte page, std::initializer_list<std::pair<const std::string, std::string>> fields) {
  AsyncWebServerRequest request{fields};
  return castleTekWLEDValidateSettings(&request, page);
}

static bool fixedForm(std::initializer_list<std::pair<const std::string, std::string>> overrides) {
  AsyncWebServerRequest request;
  request.fields["CTOP"] = "2";
  const int pins[] = {DATA_PINS};
  for (size_t i = 0; i < sizeof(pins)/sizeof(pins[0]); i++) {
    const std::string suffix = std::to_string(i);
    request.fields["L0"+suffix] = std::to_string(pins[i]);
    request.fields["LT"+suffix] = "22";
    request.fields["LC"+suffix] = i ? "1" : "10";
    request.fields["LS"+suffix] = std::to_string(i ? 9+i : 0);
    request.fields["EN"+suffix] = "1";
  }
  for (const auto& field : overrides) {
    if (field.second == "MISSING") request.fields.erase(field.first);
    else request.fields[field.first] = field.second;
  }
  return castleTekWLEDValidateSettings(&request, SUBPAGE_LEDS);
}

int main() {
  constexpr int pins[] = {DATA_PINS};
  constexpr size_t count = sizeof(pins) / sizeof(pins[0]);
  uint64_t used = 0;
  const int invalid[] = {23};
  check(!castleTekWLEDClaimFixedPins(invalid, 1, pins, count, used));
  check(used == 0);
  const int duplicate[] = {16, 16};
  check(!castleTekWLEDClaimFixedPins(duplicate, 2, pins, count, used));
  check(used == 0);
  check(castleTekWLEDClaimFixedPins(pins, count, pins, count, used));
  const auto full = used;
  check(!castleTekWLEDClaimFixedPins(pins, 1, pins, count, used));
  check(used == full);

  check(config("{}"));

  for (size_t i = 0; i < count; i++) {
    uint8_t slotPins[OUTPUT_MAX_PINS] = {uint8_t(pins[i]),255,255,255,255};
    check(castleTekWLEDValidateBusSlot(TYPE_WS2812_RGB, slotPins, i));
    check(!castleTekWLEDValidateBusSlot(TYPE_WS2812_RGB, slotPins, count));
    if (i) check(!castleTekWLEDValidateBusSlot(TYPE_WS2812_RGB, slotPins, 0));
  }
  check(fixedForm({}));
  check(fixedForm({{"EN0","MISSING"}}));
  check(!fixedForm({{"CTOP","MISSING"}}));
  check(!fixedForm({{"EN0","false"}}));
  check(!fixedForm({{"LS0","1garbage"}}));
  check(!fixedForm({{"LC0","0"}}));
  check(!fixedForm({{"RL","16"}}));
  check(fixedForm({{"RL","15"}}));
  check(fixedForm({{"RL","23"}}) == (castleTekWLEDFixedRelayPin() < 0));
  check(fixedForm({{"RL","-1"}}) == (castleTekWLEDFixedRelayPin() < 0));
  check(!fixedForm({{"RL","15garbage"}}));
  check(!config(R"({"hw":{"relay":{"pin":16}}})"));
  check(config(R"({"hw":{"relay":{"pin":15}}})"));
  check(config(R"({"hw":{"relay":{"pin":23}}})") == (castleTekWLEDFixedRelayPin() < 0));
  check(config(R"({"hw":{"relay":{"pin":-1}}})") == (castleTekWLEDFixedRelayPin() < 0));
  check(!config(R"({"hw":{"relay":{"pin":"15"}}})"));
  check(!config(R"({"hw":{"relay":{"pin":true}}})"));
  check(!config(R"({"hw":{"relay":{"pin":15.5}}})"));
  check(!config(R"({"hw":{"relay":{"pin":null}}})"));
  check(!fixedForm({{"LT0","80"}}));
  check(!fixedForm({{"L00","MISSING"}}));
  if (count == 4) {
    check(!fixedForm({{"L01","1"},{"L02","3"}}));
    check(!fixedForm({{"L04","5"},{"LT4","22"}}));
  }
  // Fixed connector requests are complete, ordered, typed, and indivisible.
  const std::string complete = "{\"hw\":{\"led\":{\"ct-policy\":2,\"ins\":" + fixedRows() + "}}}";
  check(config(complete.c_str()));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":[]}}})"));
  DynamicJsonDocument changed(8192);
  for (int invalid = 0; invalid < 9; invalid++) {
    check(!deserializeJson(changed, complete));
    JsonArray outputs = changed["hw"]["led"]["ins"];
    switch (invalid) {
      case 0: outputs[0].remove("enabled"); break;
      case 1: outputs[0]["enabled"] = 0; break;
      case 2: outputs[0]["enabled"] = "false"; break;
      case 3: outputs.remove(outputs.size()-1); break;
      case 4: outputs[0]["pin"][0] = 23; break;
      case 5: outputs[0]["type"] = TYPE_NET_DDP_RGB; break;
      case 6: outputs[0]["type"] = TYPE_ANALOG_3CH; break;
      case 7: outputs[0]["len"] = 0; break;
      case 8: outputs[0]["start"] = MAX_LEDS; break;
    }
    std::string bytes;
    serializeJson(changed, bytes);
    check(!config(bytes.c_str()));
    changed.clear();
  }
  check(!deserializeJson(changed, complete));
  for (JsonObject row : changed["hw"]["led"]["ins"].as<JsonArray>()) row["enabled"] = false;
  std::string allDisabled;
  serializeJson(changed, allDisabled);
  check(config(allDisabled.c_str()));
  changed.clear();

  DynamicJsonDocument migration(8192);
  for (const char* marker : {"3", "true", "\"2\"", "null"}) {
    const std::string input = std::string("{\"ct-policy\":") + marker + ",\"ins\":" + fixedRows() + "}";
    check(!deserializeJson(migration, input));
    std::string before, after;
    serializeJson(migration, before);
    check(!castleTekWLEDPrepareLEDConfig(migration.as<JsonObject>(), false));
    serializeJson(migration, after);
    check(before == after);
    migration.clear();
  }
  JsonObject fullSpan = migration.to<JsonObject>();
  JsonObject existing = fullSpan.createNestedArray("ins").createNestedObject();
  existing["type"] = TYPE_WS2812_RGB;
  existing.createNestedArray("pin").add(16);
  existing["start"] = 0;
  existing["len"] = MAX_LEDS;
  check(castleTekWLEDPrepareLEDConfig(fullSpan, false));
  check(fullSpan["ins"][0]["len"] == MAX_LEDS && fullSpan["ins"][0]["enabled"] == true);
  for (size_t i = 1; i < count; i++) {
    check(fullSpan["ins"][i]["enabled"] == false && fullSpan["ins"][i]["len"] == 1);
    check(fullSpan["ins"][i]["start"] == 0); // Disabled metadata never reserves space.
  }
  migration.clear();
  JsonObject fresh = migration.to<JsonObject>();
  check(castleTekWLEDPrepareLEDConfig(fresh, true));
  check(fresh["ct-policy"] == 2);
  check(fresh["ins"].size() == count);
  for (size_t i = 0; i < count; i++) {
    check(fresh["ins"][i]["pin"][0] == pins[i]);
    check(fresh["ins"][i]["enabled"].as<bool>() == (i == 0));
    check(fresh["ins"][i]["len"].as<unsigned>() == (i == 0 ? 10U : 1U));
    check(fresh["ins"][i]["start"].as<unsigned>() == (i == 0 ? 0U : 10U));
  }
  std::string freshBytes, reloadedBytes;
  serializeJson(fresh, freshBytes);
  check(castleTekWLEDPrepareLEDConfig(fresh, false));
  serializeJson(fresh, reloadedBytes);
  check(freshBytes == reloadedBytes);
  if (count > 1) {
    fresh["ins"][1]["enabled"] = true;
    check(castleTekWLEDPrepareLEDConfig(fresh, false));
    check(fresh["ins"][1]["enabled"] == true && fresh["ins"][1]["len"] == 1);
  }
  migration.clear();
  check(!deserializeJson(migration, R"({"ins":[{"type":22,"pin":[4],"start":100,"len":20,"order":2,"rev":true},{"type":22,"pin":[16],"start":0,"len":40,"order":1},{"type":80,"pin":[192,168,1,2],"start":200,"len":30}]})"));
  JsonObject legacy = migration.as<JsonObject>();
  check(castleTekWLEDPrepareLEDConfig(legacy, false));
  check(legacy["ins"].size() == count);
  check(legacy["ins"][0]["start"] == 0 && legacy["ins"][0]["len"] == 40 && legacy["ins"][0]["enabled"] == true);
  if (count == 4 && pins[3] == 4) {
    check(legacy["ins"][3]["start"] == 100 && legacy["ins"][3]["len"] == 20 && legacy["ins"][3]["rev"] == true);
    check(legacy["ins"][1]["start"] == 120 && legacy["ins"][1]["len"] == 1 && legacy["ins"][1]["enabled"] == false);
    check(legacy["ins"][2]["start"] == 120 && legacy["ins"][2]["enabled"] == false);
  } else {
    for (size_t i = 1; i < count; i++) {
      check(legacy["ins"][i]["start"].as<unsigned>() == 40);
      check(legacy["ins"][i]["len"] == 1 && legacy["ins"][i]["enabled"] == false);
    }
  }
  // An installed generic controller already marked policy 2 still needs its
  // three new slots persisted. Exercise the actual cfg.cpp boot-save decision.
  migration.clear();
  const char* installedSingle = R"({"hw":{"led":{"ct-policy":2,"maxpwr":1234,"ins":[{"type":22,"pin":[16],"start":7,"len":30,"enabled":true,"order":2,"rev":true,"skip":2,"future":{"keep":42}}]}},"id":{"name":"Receiver"},"sync":{"mode":"lan"}})";
  check(!deserializeJson(migration, installedSingle));
  persistedConfig = installedSingle;
  std::string installedOutput;
  serializeJson(migration["hw"]["led"]["ins"][0], installedOutput);
  check(castleTekWLEDOutputsNeedMigration(migration["hw"]["led"].as<JsonObject>()));
  check(loadLEDConfig(migration.as<JsonObject>()));
  check(migration["hw"]["led"]["ins"].size() == count);
  std::string migratedOutput;
  serializeJson(migration["hw"]["led"]["ins"][0], migratedOutput);
  check(installedOutput == migratedOutput);
  check(migration["hw"]["led"]["maxpwr"] == 1234 && migration["id"]["name"] == "Receiver");
  check(migration["sync"]["mode"] == "lan");
  for (size_t i = 1; i < count; i++) {
    JsonObject added = migration["hw"]["led"]["ins"][i];
    check(added["pin"][0] == pins[i]);
    check(added["enabled"] == false && added["len"] == 1);
    check(added["start"].as<unsigned>() == 37);
  }
  std::string savedFour;
  serializeJson(migration, savedFour);
  migration.clear();
  check(!deserializeJson(migration, savedFour));
  persistedConfig = savedFour;
  check(!castleTekWLEDOutputsNeedMigration(migration["hw"]["led"].as<JsonObject>()));
  check(!loadLEDConfig(migration.as<JsonObject>())); // No repeated boot write.
  std::string reloadedFour;
  serializeJson(migration, reloadedFour);
  check(savedFour == reloadedFour);
  persistedConfig.clear();
  migration.clear();
  check(!deserializeJson(migration, R"({"hw":{"led":{}}})"));
  check(loadLEDConfig(migration.as<JsonObject>())); // Fresh install also persists.
  JsonArray defaults = migration["hw"]["led"]["ins"];
  check(defaults.size() == count);
  for (size_t i = 0; i < count; i++) {
    check(defaults[i]["pin"][0] == pins[i]);
    check(defaults[i]["enabled"].as<bool>() == (i == 0));
    check(defaults[i]["len"].as<unsigned>() == (i == 0 ? 10U : 1U));
  }
  check(!config(R"({"hw":{"led":{"ins":[{"type":22,"pin":[16],"len":200,"future":{"keep":true}}]}},"future":[1,2]})"));
  check(!config(R"({"hw":{"led":{"ins":[]}}})"));
  for (const char* invalidJSON : {
    "null", "[]",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":[4294967312]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":[null]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":[18]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":[true]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":[16.5]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":["16"]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":true,"pin":[16]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":[]}]}}})",
    R"({"hw":{"led":{"ins":[{"type":22,"pin":[16]},{"type":22,"pin":[16]}]}}})",
    R"({"hw":{"led":{"ins":[null]}}})",
    R"({"hw":{"led":{"ins":"invalid"}}})",
    R"({"hw":{"btn":{"ins":[{"type":2,"pin":[18],"macros":[0,0,0]}]}}})",
    R"({"hw":{"btn":{"ins":[{"type":2,"pin":[0],"macros":[1,0,0]}]}}})",
    R"({"hw":{"btn":{"ins":[]}}})",
    R"({"hw":{"btn":{"tt":33}}})",
    R"({"hw":{"btn":{"pull":false}}})",
    R"({"hw":{"btn":{"mqtt":true}}})",
    R"({"hw":{"ir":{"pin":16}}})",
    R"({"hw":{"ir":{"type":8}}})",
    R"({"hw":{"ir":{"sel":false}}})",
    R"({"id":{"sui":true}})",
    R"({"id":{"sui":0}})"
  }) check(!config(invalidJSON));

  check(config(R"({"id":{"name":"Eaves","sui":false},"hw":{"btn":{"pull":true,"tt":32,"mqtt":false,"ins":[{"type":2,"pin":[0],"macros":[0,0,0],"future":7}]},"ir":{"pin":-1,"type":0,"sel":true}},"future":"retained"})"));
  // IPv4 addresses and HUB75 panel geometry are not GPIO assignments.
  check(!config(R"({"hw":{"led":{"ins":[{"type":80,"pin":[192,168,1,18]},{"type":64,"pin":[64,32,2,1,2]},{"type":22,"pin":[16]}]}}})"));
  check(!config(R"({"hw":{"led":{"ins":[{"type":150,"pin":[16]}]}}})"));
  check(!config(R"({"hw":{"led":{"ins":[{"type":50,"pin":[16,3]}]}}})"));
  check(!config(R"({"hw":{"led":{"ins":[{"type":43,"pin":[16,3,1]}]}}})"));
  check(!config(R"({"hw":{"led":{"ins":[{"type":22,"pin":[4]},{"type":22,"pin":[16]}]}}})"));

  check(!restore("{}"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":null}}})"));
  check(restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":[{"type":22,"pin":[16]}]}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":[{"type":22,"pin":[18]}]}}})"));
  simplifiedUI = true;
  check(config("{}")); // A partial request can omit protected values.
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!restore(R"({"um":{},"id":{"sui":false},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(restore(R"({"um":{},"id":{"sui":true},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  simplifiedUI = false;
  irApplyToAllSelected = false;
  check(config("{}"));
  check(config(R"({"hw":{"ir":{"sel":false}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"},"ir":{"sel":true}}})"));
  check(restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"},"ir":{"sel":false}}})"));
  irApplyToAllSelected = true;

  // Hidden Usermods settings preserve installed modules, while unrelated partial
  // writes and complete unchanged backups remain accepted.
  check(config(R"({"um":{}})"));
  check(!config(R"({"um":null})"));
  check(!config(R"({"um":[]})"));
  check(!config(R"({"um":{"Unknown":{"enabled":true}}})"));
  installedUsermods = R"({"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"x","options":{"flag":false}}})";
  check(config("{}"));
  check(config(R"({"um":{"Future":{"options":{"flag":false},"mode":"x"},"AudioReactive":{"pins":[4,-1],"gain":10,"enabled":true}},"future":{"preserve":1}})"));
  for (const char* changed : {
    R"({"um":{}})",
    R"({"um":{"AudioReactive":{"enabled":false,"gain":10,"pins":[4,-1]},"Future":{"mode":"x","options":{"flag":false}}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":11,"pins":[4,-1]},"Future":{"mode":"x","options":{"flag":false}}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,5]},"Future":{"mode":"x","options":{"flag":false}}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"x","options":{"flag":true}}}})",
    R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1],"new":1},"Future":{"mode":"x","options":{"flag":false}}}})"
  }) check(!config(changed));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(restore(R"({"um":{"AudioReactive":{"enabled":true,"gain":10,"pins":[4,-1]},"Future":{"mode":"x","options":{"flag":false}}},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  installedUsermods = "{}";
  check(!restore(R"({"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!restore(R"({"um":{},"hw":{"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  i2c_sda = 21; i2c_scl = 22;
  spi_mosi = 23; spi_sclk = 18; spi_miso = 19;
  check(config("{}"));
  check(config(R"({"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]}},"id":{"name":"Eaves"}})"));
  for (const char* changed : {
    R"({"hw":{"if":{"i2c-pin":[22,21]}}})",
    R"({"hw":{"if":{"i2c-pin":[21]}}})",
    R"({"hw":{"if":{"i2c-pin":[21,22,0]}}})",
    R"({"hw":{"if":{"i2c-pin":null}}})",
    R"({"hw":{"if":{"i2c-pin":[true,22]}}})",
    R"({"hw":{"if":{"spi-pin":[23,19,18]}}})",
    R"({"hw":{"if":{"spi-pin":[23,18]}}})",
    R"({"hw":{"if":{"spi-pin":[23,18,"19"]}}})"
  }) check(!config(changed));
  check(restore(R"({"um":{},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[23,18,19]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  i2c_sda = i2c_scl = spi_mosi = spi_sclk = spi_miso = -1;
  // Installed file values can predate setup normalization and include fields
  // absent from addToConfig. Only this controller's current file is a baseline.
  installedUsermods = R"({"AudioReactive":{"enabled":false,"sync":{"mode":2}}})";
  persistedConfig = fixedFixture(R"({"um":{"AudioReactive":{"enabled":true,"sync":{"mode":0},"obsolete":{"value":7}},"Retired":{"keep":true}},"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]},"led":{"ins":"FIXED_OUTPUTS"}}})");
  persistedReads = 0;
  check(config("{}"));
  check(config(R"({"um":{"AudioReactive":{"enabled":false,"sync":{"mode":2}}}})"));
  check(persistedReads == 0); // Ordinary/runtime requests need no flash reads.
  check(config(R"({"um":{"Retired":{"keep":true},"AudioReactive":{"obsolete":{"value":7},"sync":{"mode":0},"enabled":true}}})"));
  check(persistedReads == 1);
  check(config(R"({"hw":{"if":{"i2c-pin":[21,22],"spi-pin":[23,18,19]}}})"));
  check(restore(persistedConfig.c_str()));
  check(!config(R"({"um":{"AudioReactive":{"enabled":true,"sync":{"mode":0},"obsolete":{"value":8}},"Retired":{"keep":true}}})"));
  check(!config(R"({"um":{"AudioReactive":{"enabled":true,"sync":{"mode":0},"obsolete":{"value":7}},"Retired":{"keep":true},"New":{"enabled":true}}})"));
  check(!config(R"({"um":{"AudioReactive":{"enabled":true,"sync":{"mode":0},"obsolete":{"value":7}}}})"));
  check(!config(R"({"hw":{"if":{"i2c-pin":[21,23]}}})"));
  check(!config(R"({"hw":{"if":{"spi-pin":[23,18,22]}}})"));
  const auto installedFile = persistedConfig;
  persistedConfig += " trailing";
  check(!restore(installedFile.c_str()));
  persistedConfig = "{broken";
  check(!restore(installedFile.c_str()));
  persistedConfig.clear();
  check(!restore(installedFile.c_str()));
  persistedConfig = installedFile;
  persistedConfig.insert(1, std::string("\"unrelated\":\"") + std::string(JSON_BUFFER_SIZE * 2, 'x') + "\",");
  check(restore(installedFile.c_str())); // Filtering excludes large unrelated data.
  persistedConfig = R"({"um":{"oversized":")" + std::string(JSON_BUFFER_SIZE * 2, 'x') + R"("}})";
  check(!restore(installedFile.c_str()));
  persistedConfig.clear();
  installedUsermods = "{}";

  overflowUsermods = true;
  check(!config(R"({"um":{}})"));
  check(config("{}")); // No allocation needed when a partial request omits usermods.
  overflowUsermods = false;
  check(!form(SUBPAGE_UM, {}));
  check(!form(SUBPAGE_UM, {{"SDA","21"},{"SCL","22"},{"RBT","on"}}));

  check(form(SUBPAGE_UI, {{"DS","Eaves"}}));
  check(!form(SUBPAGE_UI, {{"DS","Eaves"},{"SU","on"}}));
  check(!form(SUBPAGE_UI, {{"DS","Eaves"},{"IR","16"}}));
  check(!form(SUBPAGE_UI, {{"SU","on"}}));
  simplifiedUI = true;
  check(form(SUBPAGE_UI, {{"DS","Eaves"},{"SU","on"},{"CTRID","request-id"}}));
  check(!form(SUBPAGE_UI, {{"DS","Eaves"}}));
  simplifiedUI = false;

  check(!form(SUBPAGE_LEDS, {{"L00","16"},{"LT0","22"},{"LC0","300"},{"RL","18"}}));
  check(!form(SUBPAGE_LEDS, {{"L00","18"},{"LT0","22"}}));
  check(!form(SUBPAGE_LEDS, {{"L00","16garbage"},{"LT0","22"}}));
  check(!form(SUBPAGE_LEDS, {{"L00","16"},{"LT0","22"},{"L01","16"},{"LT1","22"}}));
  check(!form(SUBPAGE_LEDS, {{"IR","16"}}));
  check(!form(SUBPAGE_LEDS, {{"IT","8"}}));
  check(!form(SUBPAGE_LEDS, {{"BT0","16"}}));
  check(!form(SUBPAGE_LEDS, {{"BE0","0"}}));
  check(!form(SUBPAGE_LEDS, {{"BT0","0"},{"BE0","2"},{"IR","-1"},{"IT","0"},{"TT","32"}}));
  check(!form(SUBPAGE_LEDS, {{"L00","192"},{"L10","168"},{"L20","1"},{"L30","18"},{"LT0","80"}}));
  check(form(SUBPAGE_TIME, {{"H0","18"},{"N0","30"},{"T0","5"}}));
  check(form(SUBPAGE_TIME, {{"MP0","0"},{"ML0","0"},{"MD0","0"},{"T0","5"}}));
  check(!form(SUBPAGE_TIME, {{"MP0","1"},{"T0","5"}}));
  check(!form(SUBPAGE_TIME, {{"ML0","1"}}));
  check(!form(SUBPAGE_TIME, {{"MD0","1"}}));
  // SU/MD have unrelated meanings on Security and Sync pages.
  check(form(SUBPAGE_SEC, {{"SU","on"}}));
  check(form(SUBPAGE_SYNC, {{"MD","topic"}}));
  check(form(SUBPAGE_SYNC, {}));
  check(form(SUBPAGE_SYNC, {{"BD","1152"}}));
  check(!form(SUBPAGE_SYNC, {{"BD","2304"}}));
  check(!form(SUBPAGE_SYNC, {{"BD","1152garbage"}}));
  check(config(R"({"hw":{"baud":1152}})"));
  check(!config(R"({"hw":{"baud":2304}})"));
  check(!config(R"({"hw":{"baud":"1152"}})"));
  check(!config(R"({"hw":{"baud":true}})"));
  check(!restore(R"({"hw":{"baud":2304}})"));


  check(!castleTekWLEDBackupFailed());
  castleTekWLEDSetBackupFailed(true);
  check(castleTekWLEDBackupFailed());
  check(!config("{}"));
  check(!restore(R"({"um":{},"hw":{"if":{"i2c-pin":[-1,-1],"spi-pin":[-1,-1,-1]},"led":{"ins":"FIXED_OUTPUTS"}}})"));
  check(!form(SUBPAGE_LEDS, {{"L00","16"},{"LT0","22"}}));
  check(!form(SUBPAGE_UI, {{"DS","Eaves"}}));
  check(!form(SUBPAGE_TIME, {{"H0","18"},{"T0","5"}}));
  check(!form(SUBPAGE_SEC, {{"PIN","1234"}}));
  check(form(SUBPAGE_PINREQ, {{"PIN","1234"}}));
  check(form(SUBPAGE_SEC, {{"RS","on"}}));
  DynamicJsonDocument failedMetadata(1024);
  castleTekWLEDSerializeHardware(failedMetadata.to<JsonObject>());
  check(failedMetadata["hardware"]["backupFailed"] == true);
  check(failedMetadata["hardware"]["usermodsEditable"] == false);
  Print failedScript;
  castleTekWLEDPrintHardware(failedScript);
  check(failedScript.stream.str().find("d.ct_cfg_backup_failed=1;") != std::string::npos);
  castleTekWLEDSetBackupFailed(false);
  check(config("{}"));
  check(form(SUBPAGE_UI, {{"DS","Eaves"}}));

  DynamicJsonDocument metadata(1024);
  castleTekWLEDSerializeHardware(metadata.to<JsonObject>());
  check(metadata["hardware"]["policy"] == 2);
  check(metadata["hardware"]["activeOutputRanges"] == true);
  check(metadata["hardware"]["ledPins"].size() == count);
  check(metadata["hardware"]["buttonsEditable"] == false);
  Print script;
  castleTekWLEDPrintHardware(script);
  check(script.stream.str().find("d.ct_dmx_supported=false;d.ct_hw_policy=2;d.ct_active_output_ranges=1;d.ct_led_pins=[16") != std::string::npos);
  check(metadata["hardware"]["fixedRelayPin"].is<int>() == (castleTekWLEDFixedRelayPin() >= 0));
  if (castleTekWLEDFixedRelayPin() >= 0) {
    check(metadata["hardware"]["fixedRelayPin"] == 15);
    check(script.stream.str().find("d.ct_relay_pin=15;") != std::string::npos);
  }
  BusManager::buses = {{TYPE_NET_DDP_RGB},{TYPE_NET_ARTNET_RGB},{TYPE_NET_DDP_RGBW},{TYPE_NET_ARTNET_RGBW},{TYPE_NET_E131_RGB}};
  metadata.clear();
  castleTekWLEDSerializeHardware(metadata.to<JsonObject>());
  check(metadata["hardware"]["dmxSupported"] == false);
  check(metadata["hardware"]["unavailableNetworkOutputs"].size() == 3);
  check(metadata["hardware"]["unavailableNetworkOutputs"][0] == 1);
  check(metadata["hardware"]["unavailableNetworkOutputs"][1] == 3);
  check(metadata["hardware"]["unavailableNetworkOutputs"][2] == 4);
  check(BusManager::buses[1].getType() == TYPE_NET_ARTNET_RGB);
  std::cout << "policy checks passed: " << checks << '\n';
}
