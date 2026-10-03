static unsigned checks=0;
#define CHECK(value) do { ++checks; if (!(value)) { std::cerr << "Check failed at line " << __LINE__ << ": " #value "\n"; std::exit(1); } } while(0)
static JsonObject row(JsonArray items, unsigned index=0, const char* kind="daily") {
  JsonObject result=items.createNestedObject();
  char id[37]; snprintf(id,sizeof(id),"00000000-0000-4000-8000-%012u",index);
  result["id"]=std::string(id);result["name"]="Eaves";result["enabled"]=true;result["preset"]=3;
  result["kind"]=kind;result["start"]=1080;result["stop"]=1380;result["stopPreset"]=0;
  result["weekdays"]=127;result["from"]=0;result["to"]=0;result["offset"]=0;
  result["holiday"]=std::string(kind)=="holiday"?"christmas":"";
  result["observed"]=false;result["before"]=0;result["after"]=0;result["solarWindow"]=false;
  return result;
}
static std::string asText(JsonVariantConst value) { std::string output;serializeJson(value,output);return output; }
static void reset() {
  ctSchedules=CastleTekScheduleState();ctPersistedScheduleRevision=0;ctScheduleSaveError=false;
  ctScheduleAvailable=true;ctScheduleOpaqueLost=false;ctScheduleSerializationFailed=false;ctOpaqueSchedules="";ctLastScheduleMinute=UINT32_MAX;
  timers.clear();toki.source=150;sunrise=0;sunset=0;localTime=0;bri=100;pendingPreset=-1;appliedCount=0;toggles=0;notifications=0;
  failWrite=failOpen=failRename=failLock=backupFailed=false;fileWrites=secretWrites=backups=0;jsonLocked=false;afterJSONUnlock=nullptr;
  WLED_FS.files.clear();WLED_FS.files["/cfg.json"]=std::make_shared<std::string>("installed config");
}
static AsyncWebServerRequest form(JsonArray items,uint32_t revision=0) {
  AsyncWebServerRequest value;value.fields["CTSC"]=asText(items);value.fields["CTSR"]=std::to_string(revision);return value;
}
static void timeAt(int y,int m,int d,int h,int n) { localTime=time_t(ctDay(y,m,d))*86400+h*3600+n*60; }
static int action(const CastleTekScheduleState& state,int y,int m,int d,int h,int n,int rise=360,int set=1080) {
  return ctScheduleAction(state,y,ctDay(y,m,d),h*60+n,rise,set);
}
static bool oversizedConfig=false;
static void serializeConfig(JsonObject root) {
  root["unrelated"]="preserved";
  if(oversizedConfig)root["tooLarge"]=std::string(50000,'x');
  castleTekWLEDSerializeScheduleConfig(root.createNestedObject("timers"));
}
int main() {
  reset();
  unrelatedFormWrites=0;
  static_assert(ARDUINOJSON_USE_LONG_LONG == 0, "match the embedded JSON integer configuration");
  DynamicJsonDocument scalar(256);
  CHECK(!deserializeJson(scalar,"4294967295"));CHECK(ctInteger(scalar.as<JsonVariantConst>(),0,UINT32_MAX));CHECK(!ctInteger(scalar.as<JsonVariantConst>(),0,INT32_MAX));
  CHECK(!deserializeJson(scalar,"4294967296"));CHECK(!ctInteger(scalar.as<JsonVariantConst>(),0,UINT32_MAX));
  CHECK(!deserializeJson(scalar,"-2147483648"));CHECK(ctInteger(scalar.as<JsonVariantConst>(),INT32_MIN,0));CHECK(!ctInteger(scalar.as<JsonVariantConst>(),0,UINT32_MAX));
  CHECK(!deserializeJson(scalar,"-2147483649"));CHECK(!ctInteger(scalar.as<JsonVariantConst>(),INT32_MIN,UINT32_MAX));
  CHECK(!deserializeJson(scalar,"1.0"));CHECK(!ctInteger(scalar.as<JsonVariantConst>(),0,250));
  CHECK(!deserializeJson(scalar,"true"));CHECK(!ctInteger(scalar.as<JsonVariantConst>(),0,250));
  CHECK(!deserializeJson(scalar,"\"1\""));CHECK(!ctInteger(scalar.as<JsonVariantConst>(),0,250));
  CHECK(ctDay(1970,1,1)==0);CHECK(ctWeekday(0)==3);CHECK(ctDay(2000,3,1)-ctDay(2000,2,28)==2);
  CHECK(ctDay(2100,3,1)-ctDay(2100,2,28)==1);
  CHECK(ctValidDate(20000229));CHECK(!ctValidDate(20230229));CHECK(!ctValidDate(21000229));CHECK(!ctValidDate(20251301));
  CHECK(ctHolidayDay(2026,0,false)==ctDay(2026,1,1));
  CHECK(ctHolidayDay(2022,0,true)==ctDay(2021,12,31));
  CHECK(ctHolidayDay(2027,5,true)==ctDay(2027,7,5));
  CHECK(ctHolidayDay(2026,5,true)==ctDay(2026,7,3));
  CHECK(ctHolidayDay(2026,9,false)==ctDay(2026,11,26));
  CHECK(ctHolidayDay(2024,13,false)==ctDay(2024,3,31));
  CHECK(ctHolidayDay(2025,13,false)==ctDay(2025,4,20));
  CHECK(ctHolidayDay(2026,13,false)==ctDay(2026,4,5));
  CHECK(ctHolidayDay(2038,13,false)==ctDay(2038,4,25));
  CHECK(ctHolidayDay(2026,14,false)==ctDay(2026,5,10));
  CHECK(ctHolidayDay(2026,15,false)==ctDay(2026,6,21));
  for(int y=1970;y<=2099;y++) {
    for(int holiday=0;holiday<19;holiday++) {
      int32_t actual=ctHolidayDay(y,holiday,false), observed=ctHolidayDay(y,holiday,true);
      CHECK(actual>=ctDay(y,1,1)&&actual<=ctDay(y,12,31));
      CHECK(std::abs(observed-actual)<=1);
      if(holiday<=10)CHECK(ctWeekday(observed)<5);else CHECK(observed==actual);
    }
    CHECK(ctWeekday(ctHolidayDay(y,1,false))==0);CHECK(ctWeekday(ctHolidayDay(y,2,false))==0);
    CHECK(ctWeekday(ctHolidayDay(y,3,false))==0);CHECK(ctWeekday(ctHolidayDay(y,6,false))==0);
    CHECK(ctWeekday(ctHolidayDay(y,7,false))==0);CHECK(ctWeekday(ctHolidayDay(y,9,false))==3);
    CHECK(ctWeekday(ctHolidayDay(y,13,false))==6);
  }
  CHECK(ctName("Front eaves"));CHECK(ctName("\xf0\x9f\x8f\xa0"));CHECK(!ctName(""));CHECK(!ctName("bad\nname"));
  CHECK(!ctName("\xc0\xaf"));CHECK(!ctName("\xed\xa0\x80"));CHECK(!ctName("\xf4\x90\x80\x80"));CHECK(!ctName("   "));CHECK(!ctName("\xc2\xa0"));CHECK(!ctName("a\xc2\x80"));
  DynamicJsonDocument document(65536);JsonArray items=document.to<JsonArray>();JsonObject first=row(items);
  CastleTekScheduleState candidate;
  CHECK(ctParseItems(items,candidate));CHECK(candidate.count==1);CHECK(ctEventCount(candidate)==2);
  const char* keys[]={"id","name","enabled","preset","kind","start","stop","stopPreset","weekdays","from","to","offset","holiday","observed","before","after","solarWindow"};
  std::string original=asText(items);
  for(const char* key:keys) {
    CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0].as<JsonObject>().remove(key);CHECK(!ctParseItems(items,candidate));
    CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0][key]=nullptr;CHECK(!ctParseItems(items,candidate));
  }
  for(const auto& invalid:std::vector<std::pair<const char*,int>>{{"preset",0},{"preset",251},{"stopPreset",251},{"start",1440},{"stop",-1},{"weekdays",0},{"weekdays",128},{"offset",-61},{"offset",61},{"before",367},{"after",-1},{"from",20230229}}) {
    CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0][invalid.first]=invalid.second;CHECK(!ctParseItems(items,candidate));
  }
  CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0]["enabled"]=1;CHECK(!ctParseItems(items,candidate));
  CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0]["future"]=true;CHECK(!ctParseItems(items,candidate));
  CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0]["start"]=1080.5;CHECK(!ctParseItems(items,candidate));
  CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0]["stop"]=1080;CHECK(!ctParseItems(items,candidate));
  CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0]["id"]="00000000-0000-4000-8000-00000000000A";CHECK(!ctParseItems(items,candidate));
  CHECK(!deserializeJson(document,original));items=document.as<JsonArray>();items[0]["kind"]="sunset";items[0]["holiday"]="christmas";items[0]["from"]=20260101;items[0]["to"]=20260105;
  CHECK(ctParseItems(items,candidate));CHECK(candidate.items[0].holiday==10);CHECK(candidate.items[0].from==20260101);
  JsonArray copy=document.createNestedArray();(void)copy;
  document.clear();items=document.to<JsonArray>();for(unsigned i=0;i<32;i++)row(items,i);CHECK(ctParseItems(items,candidate));CHECK(ctEventCount(candidate)==64);
  AsyncWebServerRequest request=form(items);CHECK(castleTekWLEDValidateScheduleSettings(&request));CHECK(castleTekWLEDApplyScheduleSettings(&request));CHECK(ctSchedules.revision==1);CHECK(ctSchedules.count==32);
  CHECK(!castleTekWLEDApplyScheduleSettings(&request));CHECK(ctSchedules.revision==1);CHECK(ctPersistedScheduleRevision==0);
  CHECK(!hostTimeForm(&request));CHECK(unrelatedFormWrites==0);
  row(items,32);CHECK(!ctParseItems(items,candidate));
  reset();document.clear();items=document.to<JsonArray>();row(items);row(items);CHECK(!ctParseItems(items,candidate));
  items=document.to<JsonArray>();row(items);request=form(items);request.fields["CTSR"]="00";CHECK(!castleTekWLEDApplyScheduleSettings(&request));
  request=form(items);request.fields["CTSC"].replace(request.fields["CTSC"].find("Eaves"),5,"Eaves\\u0000hidden");CHECK(!castleTekWLEDApplyScheduleSettings(&request));
  request=form(items);request.fields["CTSC"]+=" {}";CHECK(!castleTekWLEDApplyScheduleSettings(&request));CHECK(ctSchedules.count==0);
  request=form(items);request.fields.erase("CTSR");CHECK(!castleTekWLEDValidateScheduleSettings(&request));
  request=form(items);failLock=true;CHECK(!hostTimeForm(&request));CHECK(unrelatedFormWrites==0);CHECK(ctSchedules.revision==0);failLock=false;
  CHECK(hostTimeForm(&request));CHECK(unrelatedFormWrites==1);CHECK(!jsonLocked);
  AsyncWebServerRequest legacy;CHECK(castleTekWLEDApplyScheduleSettings(&legacy));CHECK(ctSchedules.count==1);CHECK(ctSchedules.revision==1);
  for(unsigned i=0;i<63;i++)legacy.fields["T"+std::to_string(i)]="1";CHECK(!castleTekWLEDValidateScheduleSettings(&legacy));CHECK(!hostTimeForm(&legacy));CHECK(unrelatedFormWrites==1);CHECK(ctSchedules.count==1);
  legacy.fields.erase("T62");CHECK(castleTekWLEDValidateScheduleSettings(&legacy));
  reset();request=form(items);request.fields["T0"]="2";document.clear();items=document.to<JsonArray>();for(unsigned i=0;i<32;i++)row(items,i);request=form(items);request.fields["T0"]="2";CHECK(!castleTekWLEDApplyScheduleSettings(&request));CHECK(ctSchedules.count==0);
  document.clear();items=document.to<JsonArray>();for(unsigned i=0;i<32;i++)row(items,i,"sunrise");request=form(items);for(unsigned i=0;i<32;i++)request.fields["T"+std::to_string(i)]="1";CHECK(castleTekWLEDApplyScheduleSettings(&request));
  reset();document.clear();items=document.to<JsonArray>();first=row(items);first["start"]=1320;first["stop"]=120;first["weekdays"]=16;first["from"]=20261225;first["to"]=20261225;CHECK(ctParseItems(items,candidate));
  CHECK(action(candidate,2026,12,25,22,0)==3);CHECK(action(candidate,2026,12,26,2,0)==0);CHECK(action(candidate,2026,12,26,22,0)==-1);CHECK(action(candidate,2026,12,25,2,0)==-1);
  first["start"]=1080;first["stop"]=1380;first["stopPreset"]=5;CHECK(ctParseItems(items,candidate));CHECK(action(candidate,2026,12,25,23,0)==5);
  first["kind"]="sunrise";first["offset"]=-60;CHECK(ctParseItems(items,candidate));CHECK(action(candidate,2026,12,25,5,0)==3);CHECK(action(candidate,2026,12,25,5,0,-1)==-1);
  first["offset"]=60;CHECK(ctParseItems(items,candidate));CHECK(action(candidate,2026,12,25,7,0)==3);CHECK(action(candidate,2026,12,26,7,0)==3);
  first["kind"]="holiday";first["holiday"]="new_years_day";first["solarWindow"]=true;first["weekdays"]=1;CHECK(ctParseItems(items,candidate));
  CHECK(action(candidate,2026,1,1,18,0)==3);CHECK(action(candidate,2026,1,2,6,0)==5);CHECK(action(candidate,2026,1,1,6,0)==-1);
  first["kind"]="daily";first["weekdays"]=127;CHECK(ctParseItems(items,candidate));CHECK(action(candidate,2026,12,25,23,0)==5);CHECK(action(candidate,2026,12,26,6,0)==-1);first["kind"]="holiday";
  first["observed"]=true;CHECK(ctParseItems(items,candidate));CHECK(action(candidate,2021,12,31,18,0)==3);CHECK(action(candidate,2022,1,1,6,0)==5);
  first["observed"]=false;first["before"]=366;CHECK(ctParseItems(items,candidate));CHECK(ctEligible(candidate.items[0],ctDay(2026,12,31),2026));
  first["holiday"]="easter";first["before"]=0;first["after"]=0;first["solarWindow"]=false;CHECK(ctParseItems(items,candidate));
  CHECK(action(candidate,2026,4,5,18,0)==3);CHECK(action(candidate,2027,3,28,18,0)==3);CHECK(action(candidate,2026,4,6,18,0)==-1);
  document.clear();items=document.to<JsonArray>();first=row(items,0,"holiday");first["start"]=1080;first["stop"]=1380;first["preset"]=7;
  JsonObject daily=row(items,1);daily["start"]=1080;daily["stop"]=1380;daily["preset"]=9;
  CHECK(ctParseItems(items,candidate));CHECK(action(candidate,2026,12,25,18,0)==7);CHECK(action(candidate,2026,12,24,18,0)==9);
  daily["stop"]=1080;daily["start"]=600;CHECK(ctParseItems(items,candidate));CHECK(action(candidate,2026,12,25,18,0)==7);
  reset();document.clear();items=document.to<JsonArray>();first=row(items);request=form(items);CHECK(castleTekWLEDApplyScheduleSettings(&request));
  timeAt(2026,12,25,18,0);castleTekWLEDCheckSchedules();CHECK(pendingPreset==3);CHECK(appliedCount==1);castleTekWLEDCheckSchedules();CHECK(appliedCount==1);
  timeAt(2026,12,25,23,0);pendingPreset=99;castleTekWLEDCheckSchedules();CHECK(pendingPreset==0);CHECK(bri==0);CHECK(toggles==1);CHECK(notifications==1);
  timeAt(2026,12,26,23,0);pendingPreset=99;castleTekWLEDCheckSchedules();CHECK(pendingPreset==0);CHECK(toggles==1);
  timeAt(2026,12,27,18,0);toki.source=0;castleTekWLEDCheckSchedules();CHECK(pendingPreset==0);toki.source=150;castleTekWLEDCheckSchedules();CHECK(pendingPreset==3);
  timeAt(2100,1,1,18,0);pendingPreset=-1;castleTekWLEDCheckSchedules();CHECK(pendingPreset==-1);
  DynamicJsonDocument config(65536);JsonObject cfg=config.to<JsonObject>();JsonObject tm=cfg.createNestedObject("timers");castleTekWLEDSerializeScheduleConfig(tm);
  CHECK(castleTekWLEDValidateScheduleConfig(cfg));CHECK(castleTekWLEDLoadScheduleConfig(cfg,false));CHECK(ctSchedules.revision==2);CHECK(ctPersistedScheduleRevision==0);
  reset();CHECK(castleTekWLEDLoadScheduleConfig(cfg,true));CHECK(ctSchedules.revision==1);CHECK(ctPersistedScheduleRevision==1);
  tm["ct"]["schema"]=2;tm["ct"]["future"]="preserve";std::string unknown=asText(tm["ct"]);CHECK(!castleTekWLEDValidateScheduleConfig(cfg));CHECK(castleTekWLEDLoadScheduleConfig(cfg,true));CHECK(!ctScheduleAvailable);
  DynamicJsonDocument restored(65536);castleTekWLEDSerializeScheduleConfig(restored.to<JsonObject>());CHECK(asText(restored["ct"])==unknown);
  CHECK(!castleTekWLEDApplyScheduleSettings(&request));AsyncWebServerRequest omitted;CHECK(castleTekWLEDApplyScheduleSettings(&omitted));
  reset();request=form(items);CHECK(castleTekWLEDApplyScheduleSettings(&request));configNeedsWrite=true;serializeConfigToFS();CHECK(!configNeedsWrite);CHECK(ctPersistedScheduleRevision==1);CHECK(!ctScheduleSaveError);CHECK(!WLED_FS.files.count("/.ct-upload-schedules-cfg"));
  CHECK(!deserializeJson(config,*WLED_FS.files["/cfg.json"]));CHECK(config["timers"]["ct"]["revision"]==1);CHECK(config["unrelated"]=="preserved");
  std::string installed=*WLED_FS.files["/cfg.json"];
  for(int failure=0;failure<4;failure++) {
    request=form(items,ctSchedules.revision);CHECK(castleTekWLEDApplyScheduleSettings(&request));
    failOpen=failure==0;failWrite=failure==1;failRename=failure==2;oversizedConfig=failure==3;
    configNeedsWrite=true;serializeConfigToFS();CHECK(!configNeedsWrite);CHECK(ctScheduleSaveError);CHECK(ctPersistedScheduleRevision==1);
    CHECK(*WLED_FS.files["/cfg.json"]==installed);CHECK(!WLED_FS.files.count("/.ct-upload-schedules-cfg"));
    failOpen=failWrite=failRename=oversizedConfig=false;
  }
  configNeedsWrite=true;serializeConfigToFS();CHECK(ctPersistedScheduleRevision==ctSchedules.revision);CHECK(!ctScheduleSaveError);
  Print metadata;castleTekWLEDPrintSchedules(metadata);CHECK(metadata.bytes.find("d.ct_schedules={")==0);CHECK(metadata.bytes.find("\"persistedRevision\":5")!=std::string::npos);
  reset();request=form(items);CHECK(hostTimeForm(&request));
  afterJSONUnlock = [&] { request=form(items,ctSchedules.revision);CHECK(hostTimeForm(&request)); };
  serializeConfigToFS();CHECK(ctSchedules.revision==2);CHECK(ctPersistedScheduleRevision==1);CHECK(configNeedsWrite);
  serializeConfigToFS();CHECK(ctPersistedScheduleRevision==2);CHECK(!configNeedsWrite);
  std::cout << "Schedule checks passed: " << checks << "\n";
}
