static unsigned checks = 0;
static void check(bool value) { if (!value) {std::cerr << "WiFi check failed " << checks+1 << '\n';std::abort();} ++checks; }
static void reset() {
  multiWiFi = {WiFiConfig("Home", "old-password")};
  castleTekWLEDApplyWiFiDefaults();
  noWifiSleep = true; forceReconnect = false; apActive = false;
  strlcpy(cmDNS,"eaves",sizeof(cmDNS)); dnsAddress = IPAddress(8,8,8,8); txPower = 78;
}
static std::string state() {
  DynamicJsonDocument doc(8192);
  JsonArray profiles=doc.createNestedArray("profiles");
  for (const auto& profile:multiWiFi) {
    JsonObject p=profiles.createNestedObject();p["ssid"]=profile.clientSSID;p["psk"]=profile.clientPass;
    JsonArray pins=p.createNestedArray("ip");for(size_t i=0;i<4;i++)pins.add(profile.staticIP[i]);
  }
  doc["ap"]=apSSID;doc["apPass"]=apPass;doc["channel"]=apChannel;doc["hide"]=apHide;doc["behavior"]=apBehavior;
  doc["phy"]=force802_3g;doc["sleep"]=noWifiSleep;doc["reconnect"]=forceReconnect;doc["mdns"]=cmDNS;doc["tx"]=txPower;
  std::string value;serializeJson(doc,value);return value;
}
static bool valid(const char* json) {
  DynamicJsonDocument doc(8192);check(!deserializeJson(doc,json));
  const auto before=state();const bool accepted=castleTekWLEDValidateWiFiConfig(doc.as<JsonObject>());check(before==state());return accepted;
}
static AsyncWebServerRequest request() {
  AsyncWebServerRequest r;
  r.fields={{"CS0","Home"},{"PW0","************"},{"BS0",""},{"CM","eaves"},{"TX","78"},{"WS","on"}};
  for(const char* name:{"IP00","IP01","IP02","IP03","GW00","GW01","GW02","GW03"})r.fields[name]="0";
  r.fields["SN00"]=r.fields["SN01"]=r.fields["SN02"]="255";r.fields["SN03"]="0";return r;
}
int main() {
  reset();
  check(hostMetadataMaximum()==1);
  multiWiFi.clear();check(hostMetadataMaximum()==1);
  multiWiFi={WiFiConfig("Home","old-password"),WiFiConfig("Legacy","legacy-password")};check(hostMetadataMaximum()==2);
  reset();
  check(valid("{}"));
  check(valid(R"({"ap":{"ssid":"CastleTek-Setup","pskl":9,"psk":"*********","chan":6,"hide":0,"behav":0},"wifi":{"phy":false}})"));
  check(valid(R"({"ap":{"hide":false},"nw":{"ins":[{"ssid":"Replacement","psk":"","ip":[0,0,0,0]}]}})"));
  for(const char* changed:{"null","[]",R"({"ap":null})",R"({"nw":null})",R"({"nw":{"ins":null}})",
    R"({"ap":{"ssid":"NewAP"}})",R"({"ap":{"psk":"different-pass"}})",R"({"ap":{"psk":""}})",
    R"({"ap":{"pskl":8}})",R"({"ap":{"chan":1}})",R"({"ap":{"chan":"6"}})",R"({"ap":{"hide":1}})",
    R"({"ap":{"hide":true}})",R"({"ap":{"behav":3}})",R"({"wifi":{"phy":true}})",R"({"wifi":{"phy":0}})",
    R"({"nw":{"ins":[{},{}]}})",R"({"nw":{"ins":[null]}})"
  })check(!valid(changed));
  multiWiFi.emplace_back("Legacy","legacy-password");
  check(valid(R"({"nw":{"ins":[{"ssid":"Changed"},{"ssid":"Legacy"}]}})"));
  check(!valid(R"({"nw":{"ins":[{},{},{}]}})"));
  multiWiFi.clear();check(valid(R"({"nw":{"ins":[{"ssid":"First setup"}]}})"));
  check(!valid(R"({"nw":{"ins":[{},{}]}})"));
  reset();
  auto r=request();check(hostSettings(r));check(strcmp(multiWiFi[0].clientPass,"old-password")==0);check(!forceReconnect);
  r=request();r.fields["CS0"]="Other Home";r.fields["PW0"]="new-password";check(hostSettings(r));
  check(strcmp(multiWiFi[0].clientSSID,"Other Home")==0 && strcmp(multiWiFi[0].clientPass,"new-password")==0 && forceReconnect);
  reset();r=request();r.fields["PW0"]="";check(hostSettings(r));check(multiWiFi[0].clientPass[0]=='\0' && forceReconnect);
  reset();multiWiFi[0].staticIP=IPAddress(192,168,1,7);r=request();check(hostSettings(r));check(multiWiFi[0].staticIP==IPAddress(0));
  reset();r=request();r.fields.insert({{"AS",WLED_AP_SSID},{"AP","*********"},{"AC","6"},{"AB","0"}});
  check(hostSettings(r));check(strcmp(apPass,WLED_AP_PASS)==0 && apChannel==6 && !apHide && apBehavior==0);
  for(const auto& pair:std::vector<std::pair<std::string,std::string>>{{"AS","Changed"},{"AP",""},{"AC","11"},{"AB","3"},{"AH","on"},{"FG","on"},{"CS1","Extra"},{"CS9","Extra"}}) {
    reset();r=request();r.fields[pair.first]=pair.second;r.fields["CS0"]="Must not apply";r.fields["PW0"]="must-not-apply";
    const auto before=state();check(!hostSettings(r));check(before==state());
  }
  reset();multiWiFi.emplace_back("Legacy","legacy-password");r=request();
  r.fields["CS1"]="Legacy";r.fields["PW1"]="***************";r.fields["BS1"]="";
  r.fields["IP10"]="192";r.fields["IP11"]="168";r.fields["IP12"]="10";r.fields["IP13"]="20";
  r.fields["GW10"]="192";r.fields["GW11"]="168";r.fields["GW12"]="10";r.fields["GW13"]="1";
  r.fields["SN10"]=r.fields["SN11"]=r.fields["SN12"]="255";r.fields["SN13"]="0";
  r.fields["CS0"]="Edited Home";
  check(hostSettings(r));check(multiWiFi.size()==2 && strcmp(multiWiFi[1].clientPass,"legacy-password")==0);
  check(strcmp(multiWiFi[0].clientSSID,"Edited Home")==0 && strcmp(multiWiFi[0].clientPass,"old-password")==0);
  check(multiWiFi[1].staticIP==IPAddress(192,168,10,20) && multiWiFi[1].staticGW==IPAddress(192,168,10,1) && multiWiFi[1].staticSN==IPAddress(255,255,255,0));
  r=request();check(hostSettings(r));check(multiWiFi.size()==1); // Existing explicit complete-form removal.
  reset();
  DynamicJsonDocument legacy(8192);
  check(!deserializeJson(legacy,R"({"ap":{"ssid":"OldAP","psk":"old-ap-pass","chan":11,"hide":1,"behav":3},"wifi":{"phy":true,"sleep":false},"nw":{"ins":[{"ssid":"Home"},{"ssid":"Legacy"}]}})"));
  check(hostConfig(legacy.as<JsonObject>(),true)>=0);
  check(multiWiFi.size()==2 && strcmp(multiWiFi[0].clientPass,"old-password")==0 && strcmp(multiWiFi[1].clientSSID,"Legacy")==0);
  check(strcmp(apSSID,WLED_AP_SSID)==0 && strcmp(apPass,WLED_AP_PASS)==0 && apChannel==6 && apHide==0 && apBehavior==0 && !force802_3g);
  const auto before=state();check(hostConfig(legacy.as<JsonObject>(),false)<0);check(state()==before);
  strlcpy(apPass,"tampered",sizeof(apPass));apChannel=2;force802_3g=true;
  hostSecrets(legacy.as<JsonObject>());check(strcmp(apPass,WLED_AP_PASS)==0 && apChannel==6 && !force802_3g);
  strlcpy(apSSID,"tampered",sizeof(apSSID));apBehavior=3;apHide=1;
  hostOpenAP();check(strcmp(apSSID,WLED_AP_SSID)==0 && apBehavior==0 && apHide==0);
  std::cout << "WiFi checks passed: " << checks << '\n';
}
