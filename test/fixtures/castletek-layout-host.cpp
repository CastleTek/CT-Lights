unsigned checks=0;
#define CHECK(condition) do {++checks; if(!(condition)){std::cerr<<"line "<<__LINE__<<": "<<#condition<<"\n";std::abort();}}while(0)
std::string status(){AsyncWebServerRequest request;server.get(&request);CHECK(request.status==200);return request.response;}
int post(const std::string& action,const std::string& mac="021122334450",int revision=-1,const Layout* expected=nullptr){
  DynamicJsonDocument requestDoc(8192);JsonObject root=requestDoc.to<JsonObject>();root["schema"]=2;root["action"]=action;root["mac"]=mac;
  root["expectedRevision"]=revision<0?ctLayoutRevision:uint32_t(revision);
  ctWriteBounds(root.createNestedArray("expectedSegments"),expected?*expected:ctCurrentLayout());
  AsyncWebServerRequest request;serializeJson(root,request.body);request._tempObject=&request.body[0];server.post(&request);return request.status;
}
void finish(){castleTekWLEDHandleDefaultLayout();CHECK(ctLayoutAction==LayoutAction::None);}

int invalidReverseRequest(const char* token,unsigned schema=2){
  DynamicJsonDocument requestDoc(8192),value(128);
  JsonObject root=requestDoc.to<JsonObject>();
  root["schema"]=schema;root["action"]="clear";root["mac"]=escapedMac;root["expectedRevision"]=ctLayoutRevision;
  ctWriteBounds(root.createNestedArray("expectedSegments"),ctCurrentLayout());
  JsonObject first=root["expectedSegments"][0];
  if(!strcmp(token,"missing"))first.remove("rev");
  else {CHECK(!deserializeJson(value,token));first["rev"].set(value.as<JsonVariant>());}
  AsyncWebServerRequest request;serializeJson(root,request.body);request._tempObject=&request.body[0];server.post(&request);
  return request.status;
}
void checkReverseCaptureAndLegacyRecords(){
  WLED_FS.files.clear();strip.segments={{0,30},{30,60}};strip.length=60;strip.main=0;BusManager::buses={{}};
  castleTekWLEDLoadDefaultLayout(true);
  strip.segments[0].reverse=true;strip.segments[1].reverse=false;
  CHECK(post("save")==202);finish();
  CHECK(ctSavedLayout[0].hasReverse&&ctSavedLayout[0].reverse);
  CHECK(ctSavedLayout[1].hasReverse&&!ctSavedLayout[1].reverse);
  const std::string saved=*WLED_FS.files[CT_LAYOUT_FILE];
  CHECK(saved.find("\"schema\":2")!=std::string::npos);
  CHECK(saved.find("\"rev\":true")!=std::string::npos&&saved.find("\"rev\":false")!=std::string::npos);
  for(const char* key:{"grp","spc","mi","frz","fx","col"})CHECK(saved.find(std::string("\"")+key+"\"")==std::string::npos);
  castleTekWLEDLoadDefaultLayout(true);CHECK(ctLayoutValid);CHECK(ctSavedLayout[0].reverse&&!ctSavedLayout[1].reverse);
  strip.segments={{0,60}};
  strip.segments[0].options=0xffff;strip.segments[0].reverse=false;
  strip.segments[0].grouping=4;strip.segments[0].spacing=7;strip.segments[0].mode=42;
  strip.segments[0].colors[0]=0xabcdef;
  const uint16_t inheritedOptions=strip.segments[0].options;
  CHECK(post("apply")==202);finish();
  CHECK(strip.segments.size()==2&&strip.segments[0].reverse&&!strip.segments[1].reverse);
  for(const auto& segment:strip.segments){
    CHECK((segment.options&~uint16_t(2))==(inheritedOptions&~uint16_t(2)));
    CHECK(segment.mirror&&segment.freeze&&segment.grouping==4&&segment.spacing==7);
    CHECK(segment.mode==42&&segment.colors[0]==0xabcdef);
  }
  auto expected=ctCurrentLayout();strip.segments[0].reverse=false;
  CHECK(post("clear","021122334450",-1,&expected)==409);
  CHECK(ctSavedLayout[0].reverse);
  CHECK(post("apply")==202);strip.segments[0].reverse=true;
  const unsigned previousUpdates=updates;finish();CHECK(updates==previousUpdates);
  CHECK(*WLED_FS.files[CT_LAYOUT_FILE]==saved);
  CHECK(post("clear")==202);strip.segments[0].reverse=false;finish();
  CHECK(ctLayoutSaveError&&!ctSavedLayout.empty());CHECK(*WLED_FS.files[CT_LAYOUT_FILE]==saved);
  for(const char* token:{"missing","null","0","1","1.0","\"true\"","[]","{}"})CHECK(invalidReverseRequest(token)==400);
  CHECK(invalidReverseRequest("true",1)==400);
  CHECK(post("clear")==202);finish();

  const std::string legacy="{\"schema\":1,\"mac\":\"021122334450\",\"revision\":8,\"saved\":[{\"id\":0,\"start\":0,\"stop\":30},{\"id\":2,\"start\":30,\"stop\":60}]}";
  WLED_FS.put(CT_LAYOUT_FILE,legacy);castleTekWLEDLoadDefaultLayout(true);
  CHECK(ctLayoutValid&&ctLayoutRevision==8&&!ctSavedLayout[0].hasReverse&&!ctSavedLayout[1].hasReverse);
  CHECK(*WLED_FS.files[CT_LAYOUT_FILE]==legacy);
  DynamicJsonDocument response(8192);CHECK(!deserializeJson(response,status()));
  CHECK(response["schema"].as<unsigned>()==2);
  CHECK(response["saved"][0].containsKey("rev")&&response["saved"][0]["rev"].isNull());
  CHECK(response["current"][0]["rev"].is<bool>());
  strip.segments={{0,20},{20,60}};strip.main=1;
  strip.segments[0].reverse=true;strip.segments[1].reverse=false;
  strip.segments[0].grouping=3;strip.segments[1].spacing=5;
  CHECK(post("apply")==202);finish();
  CHECK(strip.segments.size()==3&&strip.segments[0].reverse&&!strip.segments[2].reverse);
  CHECK(strip.segments[0].grouping==3&&strip.segments[2].spacing==5);
  CHECK(*WLED_FS.files[CT_LAYOUT_FILE]==legacy);CHECK(ctLayoutRevision==8);
  CHECK(post("clear")==202);finish();CHECK(ctLayoutRevision==9);
  CHECK(WLED_FS.files[CT_LAYOUT_FILE]->find("\"schema\":2")!=std::string::npos);
  CHECK(post("save")==202);finish();CHECK(ctLayoutRevision==10);
  CHECK(ctSavedLayout[0].hasReverse&&ctSavedLayout[1].hasReverse);

  // Explicit null is valid only in saved schema-2 records; missing or mistyped
  // direction fails closed. A mixed legacy/new record preserves per-row intent.
  const std::string prefix="{\"schema\":2,\"mac\":\"021122334450\",\"revision\":11,\"saved\":[{\"id\":0,\"start\":0,\"stop\":30,";
  for(const char* token:{"0","1","\"false\"","{}","[]"}){
    WLED_FS.put(CT_LAYOUT_FILE,prefix+"\"rev\":"+token+"}]}");
    castleTekWLEDLoadDefaultLayout(true);CHECK(!ctLayoutValid);
  }
  WLED_FS.put(CT_LAYOUT_FILE,"{\"schema\":2,\"mac\":\"021122334450\",\"revision\":11,\"saved\":[{\"id\":0,\"start\":0,\"stop\":30}]}");
  castleTekWLEDLoadDefaultLayout(true);CHECK(!ctLayoutValid);
  WLED_FS.put(CT_LAYOUT_FILE,prefix+"\"rev\":null},{\"id\":1,\"start\":30,\"stop\":60,\"rev\":true}]}");
  castleTekWLEDLoadDefaultLayout(true);CHECK(ctLayoutValid);
  strip.segments={{0,60}};strip.main=0;strip.segments[0].reverse=false;
  CHECK(post("apply")==202);finish();CHECK(!strip.segments[0].reverse&&strip.segments[1].reverse);
}

int main(){
  castleTekWLEDRegisterDefaultLayoutRoutes();castleTekWLEDLoadDefaultLayout(true);
  CHECK(ctLayoutValid);CHECK(ctSavedLayout.empty());CHECK(ctLayoutRevision==0);
  CHECK(post("save")==202);CHECK(ctSavedLayout.empty());CHECK(post("save")==409);finish();
  CHECK(ctLayoutValid&&!ctLayoutSaveError);CHECK(ctSavedLayout==ctCurrentLayout());CHECK(ctLayoutRevision==1);
  const std::string stored=*WLED_FS.files[CT_LAYOUT_FILE];
  CHECK(stored.find("colors")==std::string::npos);CHECK(stored.find("palette")==std::string::npos);CHECK(stored.find("mode")==std::string::npos);
  CHECK(post("save")==409);CHECK(post("clear","021122334499")==409);CHECK(post("clear","021122334450",0)==409);
  castleTekWLEDLoadDefaultLayout(true);CHECK(ctSavedLayout.size()==2);CHECK(post("save")==409);
  strip.segments={{0,60}};strip.segments[0].mode=42;strip.segments[0].colors[0]=0xabcdef;strip.segments[0].grouping=2;
  CHECK(post("apply")==202);finish();CHECK(strip.segments.size()==2);CHECK(strip.segments[0].mode==42);CHECK(strip.segments[1].mode==42);
  CHECK(strip.segments[1].colors[0]==0xabcdef);CHECK(strip.segments[1].grouping==2);CHECK(ctLayoutRevision==1);CHECK(updates==1);
  strip.segments[1].mode=99;strip.segments.emplace_back(0,60);
  CHECK(post("apply")==202);finish();CHECK(strip.segments.size()==2);CHECK(strip.segments[1].mode==99);CHECK(updates==2);
  strip.segments={{0,60}};CHECK(post("apply")==202);strip.segments[0].stop=59;finish();CHECK(!ctLayoutSaveError);CHECK(strip.segments[0].stop==59);CHECK(updates==2);
  strip.segments[0].stop=60;CHECK(post("apply")==202);allocationFailure=true;finish();allocationFailure=false;
  CHECK(!ctLayoutSaveError);CHECK(strip.segments.size()==1);CHECK(strip.segments[0].stop==60);
  contiguousHeap=100;CHECK(post("apply")==202);finish();CHECK(!ctLayoutSaveError);CHECK(strip.segments.size()==1);contiguousHeap=100000;
  BusManager::buses={{0,20},{30,30}};CHECK(post("apply")==400);
  BusManager::buses={{}};strip.isMatrix=true;CHECK(post("apply")==400);strip.isMatrix=false;
  auto before=ctCurrentLayout();CHECK(post("clear")==202);finish();CHECK(ctSavedLayout.empty());CHECK(ctCurrentLayout()==before);CHECK(ctLayoutRevision==2);
  castleTekWLEDLoadDefaultLayout(true);CHECK(ctLayoutRevision==2);CHECK(ctSavedLayout.empty());CHECK(post("apply")==409);
  strip.segments={{0,40},{30,60}};CHECK(post("save")==400);strip.segments={{0,60}};
  for(int failure=0;failure<3;failure++){
    WLED_FS.failOpen=failure==0;WLED_FS.shortWrite=failure==1;WLED_FS.failRename=failure==2;
    CHECK(post("save")==202);finish();CHECK(ctLayoutSaveError);CHECK(ctSavedLayout.empty());CHECK(ctLayoutRevision==2);
    WLED_FS.failOpen=WLED_FS.shortWrite=WLED_FS.failRename=false;
    castleTekWLEDLoadDefaultLayout(true);CHECK(ctSavedLayout.empty());CHECK(ctLayoutRevision==2);
  }
  CHECK(post("save")==202);finish();CHECK(ctLayoutRevision==3);
  strip.length=20;BusManager::buses={{0,20}};castleTekWLEDLoadDefaultLayout(true);CHECK(ctLayoutValid);CHECK(!ctSavedLayout.empty());CHECK(post("apply")==400);
  CHECK(post("clear")==202);finish();CHECK(ctLayoutRevision==4);
  WLED_FS.put(CT_LAYOUT_FILE,"{\"schema\":99,\"mac\":\"021122334450\",\"revision\":7,\"saved\":null}");
  castleTekWLEDLoadDefaultLayout(true);CHECK(!ctLayoutValid);CHECK(ctLayoutRevision==7);CHECK(post("save")==503);CHECK(post("clear")==202);finish();CHECK(ctLayoutValid);CHECK(ctLayoutRevision==8);
  WLED_FS.put(CT_LAYOUT_FILE,"{broken");castleTekWLEDLoadDefaultLayout(true);CHECK(!ctLayoutValid);CHECK(post("save")==503);
  CHECK(post("clear")==202);finish();CHECK(ctLayoutValid);
  CHECK(status().find("\"persisted\":true")!=std::string::npos);
  correctPIN=false;settingsPIN[0]='1';CHECK(post("clear")==401);correctPIN=true;settingsPIN[0]=0;
  configNeedsWrite=true;CHECK(post("clear")==409);configNeedsWrite=false;
  CHECK(post("clear")==202);configNeedsWrite=true;finish();CHECK(ctLayoutSaveError);configNeedsWrite=false;
  CHECK(post("unknown")==400);
  CHECK(ctCompleteLayoutJSON(reinterpret_cast<const uint8_t*>(" {} "),4));
  CHECK(!ctCompleteLayoutJSON(reinterpret_cast<const uint8_t*>("{}{}"),4));
  CHECK(!ctCompleteLayoutJSON(reinterpret_cast<const uint8_t*>("{}x"),3));
  CHECK(!ctCompleteLayoutJSON(reinterpret_cast<const uint8_t*>("[]"),2));
  const std::string validRecord=*WLED_FS.files[CT_LAYOUT_FILE];
  WLED_FS.put(CT_LAYOUT_FILE,validRecord+"{}");castleTekWLEDLoadDefaultLayout(true);CHECK(!ctLayoutValid);
  CHECK(post("clear")==202);finish();CHECK(ctLayoutValid);
  doReboot=true;CHECK(post("clear")==409);doReboot=false;
  doInitBusses=true;CHECK(post("clear")==409);doInitBusses=false;
  CHECK(post("clear")==202);castleTekWLEDPrepareDefaultLayoutFactoryReset();finish();CHECK(!ctLayoutFSReady);CHECK(post("clear")==503);
  castleTekWLEDLoadDefaultLayout(false);CHECK(!ctLayoutValid);CHECK(post("clear")==503);
  checkReverseCaptureAndLegacyRecords();
  std::cout<<"CastleTek default layout runtime checks passed: "<<checks<<"\n";
}
