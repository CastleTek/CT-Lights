static unsigned checks=0;
#define CHECK(x) do{checks++;if(!(x)){std::cerr<<"Check failed at line "<<__LINE__<<": "<<#x<<"\n";exit(1);}}while(0)
std::string digest(const std::vector<uint8_t>& bytes){uint8_t out[32];CC_SHA256(bytes.data(),CC_LONG(bytes.size()),out);const char* hex="0123456789abcdef";std::string s;for(auto b:out){s+=hex[b>>4];s+=hex[b&15];}return s;}
std::vector<uint8_t> image(){
 std::vector<uint8_t> v(1072,0);v[0]=0xe9;v[1]=1;v[23]=1;
 uint32_t length=1024;memcpy(v.data()+28,&length,4);
 const uint8_t magic[]={0x32,0x54,0xcd,0xab};memcpy(v.data()+32,magic,4);
 memcpy(v.data()+288,"STSW",4);v[288+115]=1;
 for(size_t i=768;i<1056;i++)v[i]=uint8_t(i*13);
 uint8_t checksum=0xef;for(size_t i=32;i<1056;i++)checksum^=v[i];v[1071]=checksum;
 uint8_t sum[32];CC_SHA256(v.data(),CC_LONG(v.size()),sum);v.insert(v.end(),sum,sum+32);return v;
}
void reset(){CHECK(castleTekUpdateOwner.load()==nullptr);Update={};strip={};doReboot=false;partitionAvailable=true;nextPartition={0x190000,0x180000};clockNow=100;allowMetadata=true;metadataCalls=0;seenMetadata.clear();failHashStart=failHashUpdate=failHashFinish=false;usermodOn=usermodOff=watchdogOn=watchdogOff=backups=bootChecks=0;}
void headers(AsyncWebServerRequest& r,const std::vector<uint8_t>& v){r.length=v.size();r.set("Content-Type","application/octet-stream");r.set("Content-Length",std::to_string(v.size()));r.set("X-CastleTek-Firmware-Size",std::to_string(v.size()));r.set("X-CastleTek-Firmware-SHA256",digest(v));r.set("X-CastleTek-Update-Key",testKey);}
void feed(AsyncWebServerRequest& r,std::vector<uint8_t>& v,size_t start,size_t n,bool local=true){handleCastleTekOTABody(&r,v.data()+start,n,start,v.size(),local);}
void complete(AsyncWebServerRequest& r,bool local=true){completeCastleTekOTA(&r,local);}
void rejected(std::function<void(AsyncWebServerRequest&)> change,int expected,bool local=true){reset();auto v=image();AsyncWebServerRequest r;headers(r,v);change(r);const bool initialReboot=doReboot;feed(r,v,0,v.size(),local);complete(r,local);CHECK(r.status==expected);CHECK(Update.begins==0);CHECK(Update.ends==0);CHECK(doReboot==initialReboot);CHECK(castleTekUpdateOwner.load()==nullptr);CHECK(r.response.find(testKey)==std::string::npos);}
int main(){
 CC_SHA256(reinterpret_cast<const unsigned char*>(testKey.data()),CC_LONG(testKey.size()),castleTekUpdateKeyDigest);
 for(size_t chunk:{size_t(1),size_t(23),size_t(767),size_t(768),size_t(1000),size_t(1104)}){
  reset();auto v=image();AsyncWebServerRequest r;headers(r,v);
  for(size_t i=0;i<v.size();){size_t n=std::min(chunk,v.size()-i);feed(r,v,i,n);i+=n;if(i<768)CHECK(Update.begins==0);}
  CHECK(Update.begins==1);CHECK(Update.bytes==v);CHECK(Update.ends==0);CHECK(!doReboot);CHECK(metadataCalls==1);CHECK(seenMetadata==std::vector<uint8_t>(v.begin()+288,v.begin()+407));CHECK(r.socket.timeout==15);
  complete(r);CHECK(r.status==200);CHECK(Update.ends==1);CHECK(Update.aborts==0);CHECK(doReboot);CHECK(bootChecks==1);CHECK(strip.resumes==1);CHECK(usermodOn==1&&usermodOff==1);CHECK(watchdogOff==1&&watchdogOn==1);complete(r);CHECK(Update.ends==1&&r.sends==1);r.disconnect();CHECK(Update.aborts==0);
 }
 rejected([](auto& r){r.erase("X-CastleTek-Update-Key");},401);
 rejected([](auto& r){r.set("X-CastleTek-Update-Key",std::string(64,'b'));},401);
 rejected([](auto& r){r.fields.push_back({"x-castletek-update-key",testKey});},401);
 rejected([](auto& r){r.route="/update";},404);
 rejected([](auto&){},403,false);
 rejected([](auto& r){r.set("Content-Type","multipart/form-data; boundary=test");},415);
 rejected([](auto& r){r.fields.push_back({"content-type","application/octet-stream"});},415);
 for(const char* h:{"Content-Length","X-CastleTek-Firmware-Size","X-Castletek-Firmware-SHA256"})rejected([&](auto& r){r.erase(h);},400);
 rejected([](auto& r){r.set("X-CastleTek-Firmware-Size","999999999999999999999");},400);
 rejected([](auto& r){r.set("X-CastleTek-Firmware-SHA256",std::string(64,'z'));},400);
 rejected([](auto& r){r.length--;},400);
 rejected([](auto& r){r.fields.push_back({String(std::string("\0bad",4)),"value"});},415);
 rejected([](auto& r){r.parameters=1;},400);
 for(const char* h:{"Content-Length","X-CastleTek-Firmware-Size","X-CastleTek-Firmware-SHA256","X-CastleTek-Update-Key"})rejected([&](auto& r){for(auto& f:r.fields)if(f.key.equalsIgnoreCase(h))f.val+=std::string("\0suffix",7);},std::string(h)=="X-CastleTek-Update-Key"?401:400);
 for(const char* h:{"Content-Encoding","Transfer-Encoding"})rejected([&](auto& r){r.set(h,"identity");},400);
 rejected([](auto&){partitionAvailable=false;},503);
 rejected([](auto&){nextPartition.address=runningPartition.address;},503);
 rejected([](auto&){doReboot=true;},503);
 for(int kind=0;kind<3;kind++){
  reset();auto v=image();AsyncWebServerRequest r;headers(r,v);if(kind==0)allowMetadata=false;if(kind==1)v[288]='X';if(kind==2)v[403]=0;feed(r,v,0,768);complete(r);CHECK(r.status==400);CHECK(Update.begins==0);CHECK(Update.ends==0);
 }
 for(size_t received:{size_t(10),size_t(768),size_t(1104)}){
  reset();auto v=image();AsyncWebServerRequest r;headers(r,v);feed(r,v,0,received);r.disconnect();CHECK(Update.ends==0);CHECK(!doReboot);CHECK(Update.aborts==(received>=768?1:0));CHECK(castleTekUpdateOwner.load()==nullptr);
 }
 {reset();auto v=image();AsyncWebServerRequest r;headers(r,v);feed(r,v,0,768);complete(r);CHECK(r.status==400);CHECK(Update.aborts==1&&Update.ends==0);CHECK(strip.resumes==1);}
 {reset();auto v=image();AsyncWebServerRequest a,b;headers(a,v);headers(b,v);feed(a,v,0,768);feed(b,v,0,768);complete(b);CHECK(b.status==409);b.disconnect();CHECK(Update.aborts==0);CHECK(castleTekUpdateOwner.load()==&a);feed(a,v,768,v.size()-768);complete(a);CHECK(a.status==200);}
 for(int kind=0;kind<6;kind++){
  reset();auto v=image();AsyncWebServerRequest r;headers(r,v);if(kind==0)Update.failBegin=true;if(kind==1)Update.failWrite=true;if(kind==2)Update.failEnd=true;if(kind==3)failHashStart=true;if(kind==4)failHashUpdate=true;if(kind==5)failHashFinish=true;feed(r,v,0,v.size());complete(r);CHECK(r.status==(kind==3?503:kind==5?400:500));CHECK(!doReboot);CHECK(castleTekUpdateOwner.load()==nullptr);CHECK(!Update.running);CHECK(Update.ends==(kind==2?1:0));CHECK(strip.suspends==strip.resumes);
 }
 {reset();auto v=image();AsyncWebServerRequest r;headers(r,v);r.set("X-CastleTek-Firmware-SHA256",std::string(64,'0'));feed(r,v,0,v.size());complete(r);CHECK(r.status==400);CHECK(Update.ends==0&&Update.aborts==1);}
 for(bool wrap:{false,true}){
  reset();auto v=image();AsyncWebServerRequest r;headers(r,v);clockNow=wrap?0xfffffff0u:100u;feed(r,v,0,768);clockNow+=300001;feed(r,v,768,v.size()-768);complete(r);CHECK(r.status==408);CHECK(Update.ends==0&&Update.aborts==1);
 }
 {reset();auto v=image();AsyncWebServerRequest r;headers(r,v);feed(r,v,0,768);feed(r,v,768,v.size()-768,false);complete(r,false);CHECK(r.status==403);CHECK(Update.aborts==1&&Update.ends==0);}
 {reset();DynamicJsonDocument doc(1024);serializeCastleTekUpdateInfo(doc.to<JsonObject>());CHECK(doc["update"]["available"].as<bool>());CHECK(doc["update"]["policy"].as<int>()==1);CHECK(!doc["update"]["browser"].as<bool>());std::string expectedHash;for(int i=0;i<32;i++)expectedHash+="42";CHECK(doc["update"]["imageSHA256"].as<std::string>()==expectedHash);serializeCastleTekUpdateInfo(doc.to<JsonObject>());CHECK(sdkHashCalls==1);}
 std::cout<<"OTA runtime checks passed: "<<checks<<"\n";
}
