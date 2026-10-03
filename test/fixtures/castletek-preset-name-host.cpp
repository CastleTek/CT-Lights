unsigned checks=0;
#define CHECK(condition) do {++checks; if(!(condition)){std::cerr<<"line "<<__LINE__<<": "<<#condition<<"\n";std::abort();}}while(0)
int rawNamePost(const std::string& body){
  AsyncWebServerRequest request;request.requestURL="/castletek/v1/json/preset-name";request.body=body;
  request._tempObject=&request.body[0];server.post(&request);return request.status;
}
int namePost(const char* expected="Original",const char* name="Roof",unsigned id=7,const char* mac="021122334450"){
  DynamicJsonDocument doc(1024);doc["schema"]=1;doc["mac"]=mac;doc["id"]=id;doc["expectedName"]=expected;doc["name"]=name;
  std::string body;serializeJson(doc,body);return rawNamePost(body);
}
void finishName(){castleTekWLEDHandlePresetName();CHECK(!ctPresetNamePending);}
std::string renamed(std::string original,const std::string& before,const std::string& after){
  const size_t position=original.find(before);CHECK(position!=std::string::npos);original.replace(position,before.size(),after);return original;
}
int main(){
  castleTekWLEDRegisterPresetNameRoutes();
  const std::string original=R"({ "0":{}, "7":{ "n" : "Original", "on":false,"bri":13,"ps":3,"win":"FX=42","seg":[{"id":0,"start":0,"stop":30,"rev":true,"col":[[1,2,3]]}],"unknown":{"n":"Nested","brace":"x}y{z","list":[null,true,2.5]} }, "8":{"n":"Other","seg":[{"id":0,"stop":0}]} })";
  WLED_FS.put(CT_PRESET_FILE,original);
  strip.segments[0].reverse=true;strip.segments[0].grouping=4;strip.segments[0].spacing=7;strip.segments[0].mode=42;
  CHECK(namePost()==202);CHECK(*WLED_FS.files[CT_PRESET_FILE]==original);CHECK(namePost()==409);
  finishName();CHECK(*WLED_FS.files[CT_PRESET_FILE]==renamed(original,"\"Original\"","\"Roof\""));
  CHECK(strip.segments.size()==2&&strip.segments[0].start==0&&strip.segments[0].stop==30);
  CHECK(strip.segments[0].reverse&&strip.segments[0].grouping==4&&strip.segments[0].spacing==7&&strip.segments[0].mode==42);
  CHECK(!stateChanged&&updates==0&&fsInfoUpdates==1&&presetsModifiedTime==123);
  CHECK(!WLED_FS.exists(CT_PRESET_NAME_TEMP));
  CHECK(namePost()==409);CHECK(namePost("Original","Roof",9)==404);CHECK(namePost("Roof","Roof",7,"021122334499")==409);

  for(const char* name:{""," leading","trailing ","line\nfeed","tab\tname","012345678901234567890123456789012","\xc0\xaf","\xed\xa0\x80","\xf4\x90\x80\x80","\xc2\x85","\xe2\x80\x8b"})CHECK(namePost("Roof",name)==400);
  CHECK(namePost("Roof","valid",0)==400);CHECK(namePost("Roof","valid",251)==400);
  const std::string request=R"({"schema":1,"mac":"021122334450","id":7,"expectedName":"Roof","name":"New"})";
  CHECK(rawNamePost(request+"{}")==400);
  CHECK(rawNamePost(renamed(request,"\"schema\":1","\"schema\":2"))==400);
  CHECK(rawNamePost(renamed(request,"\"id\":7","\"id\":true"))==400);
  CHECK(rawNamePost(renamed(request,"\"id\":7","\"id\":7.5"))==400);
  CHECK(rawNamePost(renamed(request,"\"name\":\"New\"","\"name\":null"))==400);
  CHECK(rawNamePost(renamed(request,"\"name\":\"New\"","\"name\":\"A\\u0000B\""))==400);
  CHECK(rawNamePost(renamed(request,"\"name\":\"New\"","\"name\":\"New\",\"on\":true"))==400);
  correctPIN=false;settingsPIN[0]='1';CHECK(namePost("Roof")==401);correctPIN=true;settingsPIN[0]=0;
  pendingPresetSave=true;CHECK(namePost("Roof")==409);pendingPresetSave=false;
  configNeedsWrite=true;CHECK(namePost("Roof")==409);configNeedsWrite=false;
  backupFailed=true;CHECK(namePost("Roof")==503);backupFailed=false;
  locked=true;CHECK(namePost("Roof")==409);locked=false;

  for(unsigned fault=0;fault<3;++fault){
    WLED_FS.put(CT_PRESET_FILE,original);CHECK(namePost()==202);
    WLED_FS.failOpen=fault==0;WLED_FS.shortWrite=fault==1;WLED_FS.failRename=fault==2;
    finishName();CHECK(*WLED_FS.files[CT_PRESET_FILE]==original);
    WLED_FS.failOpen=WLED_FS.shortWrite=WLED_FS.failRename=false;
    CHECK(!WLED_FS.exists(CT_PRESET_NAME_TEMP));
  }
  CHECK(namePost()==202);pendingPresetSave=true;finishName();pendingPresetSave=false;CHECK(*WLED_FS.files[CT_PRESET_FILE]==original);
  CHECK(namePost()==202);correctPIN=false;settingsPIN[0]='1';finishName();correctPIN=true;settingsPIN[0]=0;CHECK(*WLED_FS.files[CT_PRESET_FILE]==original);
  CHECK(namePost()==202);escapedMac="021122334499";finishName();escapedMac="021122334450";CHECK(*WLED_FS.files[CT_PRESET_FILE]==original);
  CHECK(namePost()==202);const auto changed=renamed(original,"Original","Different");WLED_FS.put(CT_PRESET_FILE,changed);finishName();CHECK(*WLED_FS.files[CT_PRESET_FILE]==changed);
  WLED_FS.put(CT_PRESET_FILE,original);CHECK(namePost()==202);
  const auto latest=renamed(original,"\"bri\":13","\"bri\":99");WLED_FS.put(CT_PRESET_FILE,latest);finishName();
  CHECK(*WLED_FS.files[CT_PRESET_FILE]==renamed(latest,"\"Original\"","\"Roof\""));

  for(const char* corrupt:{"{broken",R"({"7":{"n":"Original"}} {})",R"({"7":{"n":"Original","n":"Original"}})",R"({"7":{"n":"Original"},"7":{"n":"Original"}})",R"({"7":{"n":"Ori\u0000ginal"}})",R"({"7":{"n":false}})",R"({"7":{"n":"012345678901234567890123456789012"}})"}){
    WLED_FS.put(CT_PRESET_FILE,corrupt);CHECK(namePost()==503);
  }
  WLED_FS.put(CT_PRESET_FILE,R"({"7":{"\u006e":"","unknown":true}})");
  CHECK(namePost("","Roof \"A\"")==202);finishName();
  CHECK(*WLED_FS.files[CT_PRESET_FILE]==R"({"7":{"\u006e":"Roof \"A\"","unknown":true}})");
  CHECK(namePost("Roof \"A\"","🎄 Roof")==202);finishName();
  CHECK(WLED_FS.files[CT_PRESET_FILE]->find("🎄 Roof")!=std::string::npos);
  CHECK(updates==0&&!stateChanged);

  // Upload installation and file deletion cannot invalidate captured offsets,
  // replace the source mid-copy, or resurrect a catalog deleted during a yield.
  WLED_FS.put(CT_PRESET_FILE,original);
  const std::string uploadPath="/.ct-upload-test", uploaded="{\"7\":{\"n\":\"Uploaded\",\"unknown\":true}}";
  WLED_FS.put(uploadPath.c_str(),uploaded);
  CHECK(namePost()==202);
  CHECK(castleTekWLEDInstallPresetUpload(uploadPath)==409);
  CHECK(castleTekWLEDDeletePresetsFile()==409);
  unsigned races=0;
  onYield=[&](){
    ++races;
    CHECK(castleTekWLEDInstallPresetUpload(uploadPath)==409);
    CHECK(castleTekWLEDDeletePresetsFile()==409);
    CHECK(*WLED_FS.files[CT_PRESET_FILE]==original);
  };
  finishName();onYield=nullptr;CHECK(races>0);
  CHECK(*WLED_FS.files[CT_PRESET_FILE]==renamed(original,"\"Original\"","\"Roof\""));
  CHECK(castleTekWLEDInstallPresetUpload(uploadPath)==0);
  CHECK(*WLED_FS.files[CT_PRESET_FILE]==uploaded);
  CHECK(castleTekWLEDDeletePresetsFile()==0);CHECK(!WLED_FS.exists(CT_PRESET_FILE));
  castleTekWLEDHandlePresetName();CHECK(!WLED_FS.exists(CT_PRESET_FILE));
  WLED_FS.put(CT_PRESET_FILE,original);CHECK(namePost()==202);
  CHECK(requestJSONBufferLock(JSON_LOCK_SERVER,0));
  castleTekWLEDPreparePresetNameFactoryReset();WLED_FS.files.clear();releaseJSONBufferLock();
  finishName();CHECK(WLED_FS.files.empty());
  std::cout<<"CastleTek preset-name runtime checks passed: "<<checks<<"\n";
}
