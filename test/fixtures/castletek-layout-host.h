#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "src/dependencies/json/ArduinoJson-v6.h"
#define CASTLETEK_WLED_COMPAT
#define MAX_NUM_SEGMENTS 32
#define JSON_LOCK_SERVER 1
#define HTTP_GET 1
#define HTTP_POST 2
#define CALL_MODE_DIRECT_CHANGE 1
using String = std::string;
std::string escapedMac="021122334450";
bool correctPIN=true,configNeedsWrite=false,locked=false,backupFailed=false,stateChanged=false,doReboot=false,doInitBusses=false;
char settingsPIN[8]={};
DynamicJsonDocument document(16384); DynamicJsonDocument* pDoc=&document;
bool requestJSONBufferLock(int,int=250){if(locked)return false;locked=true;return true;}
void releaseJSONBufferLock(){assert(locked);locked=false;}
bool castleTekWLEDBackupFailed(){return backupFailed;}
String castleTekWLEDRoute(const char* p){return String("/castletek/v1")+p;}
struct AsyncJsonResponse {
  DynamicJsonDocument doc; int status=200;
  AsyncJsonResponse(size_t size):doc(size){}
  JsonObject getRoot(){return doc.as<JsonObject>().isNull()?doc.to<JsonObject>():doc.as<JsonObject>();}
  void setCode(int n){status=n;}
  void addHeader(const char*,const char*){}
  void setLength(){}
};
struct AsyncWebServerRequest {
  void* _tempObject=nullptr; int status=0; std::string response,body;
  String requestURL="/castletek/v1/json/default-layout";
  size_t contentLength(){return body.size();}
  String url(){return requestURL;}
  void send(int n){status=n;}
  void send(int n,const char*,const char* body){status=n;response=body;}
  void send(AsyncJsonResponse* r){status=r->status;serializeJson(r->doc,response);delete r;}
};
using Callback=std::function<void(AsyncWebServerRequest*)>;
struct AsyncCallbackJsonWebHandler {
  Callback callback;
  AsyncCallbackJsonWebHandler(const String&,Callback cb):callback(cb){}
  void setMethod(int){}
  void setMaxContentLength(int){}
};
struct ServerMock {
  Callback get,post;
  void on(const String&,int,Callback cb){get=cb;}
  void addHandler(AsyncCallbackJsonWebHandler* h){post=h->callback;delete h;}
} server;
struct File {
  std::shared_ptr<std::string> bytes;
  size_t cursor=0; bool shortWrite=false;
  File(std::shared_ptr<std::string> b={},size_t p=0,bool s=false):bytes(b),cursor(p),shortWrite(s){}
  operator bool() const {return bool(bytes);}
  size_t size() const {return bytes?bytes->size():0;}
  size_t position() const{return cursor;}
  bool seek(size_t p){if(!bytes||p>bytes->size())return false;cursor=p;return true;}
  void flush(){}
  void close(){bytes.reset();}
  int read(){return bytes&&cursor<bytes->size()?static_cast<unsigned char>((*bytes)[cursor++]):-1;}
  size_t readBytes(char* to,size_t length){size_t i=0;for(;i<length;i++){int c=read();if(c<0)break;to[i]=char(c);}return i;}
  size_t write(uint8_t c){return write(&c,1);}
  size_t write(const uint8_t* p,size_t n){if(!bytes||shortWrite)return 0;bytes->append((const char*)p,n);return n;}
};
struct FSMock {
  std::map<std::string,std::shared_ptr<std::string>> files;
  bool failOpen=false,failRename=false,shortWrite=false;
  bool exists(const char* name){return files.count(name);}
  File open(const char* name,const char* mode){
    if(failOpen)return {};
    if(*mode=='w')files[name]=std::make_shared<std::string>();
    if(!exists(name))return {};
    return {files[name],0,shortWrite};
  }
  bool rename(const char* from,const char* to){if(failRename||!exists(from))return false;files[to]=files[from];files.erase(from);return true;}
  bool remove(const char* name){return files.erase(name);}
  void put(const char* name,const std::string& value){files[name]=std::make_shared<std::string>(value);}
} WLED_FS;
bool allocationFailure=false;
size_t contiguousHeap=100000;
size_t getContiguousFreeHeap(){return contiguousHeap;}
struct Segment {
  uint16_t start=0,stop=0,offset=0;
  union {
    uint16_t options;
    struct { bool selected:1; bool reverse:1; bool on:1; bool mirror:1; bool freeze:1; };
  };
  uint8_t grouping=1,spacing=0,opacity=255,cct=0,mode=0,palette=0,speed=128,intensity=128,custom1=0,custom2=0,custom3=0;
  bool check1=false,check2=false,check3=false,reset=false;
  uint8_t blendMode=0,map1D2D=0;
  uint32_t colors[3]={0x112233,0,0};
  const char* name=nullptr;
  Segment(uint16_t a=0,uint16_t b=0):start(a),stop(b),options(0){}
  bool isActive() const{return stop>start;}
  void inheritCastleTekFrozenPixels(const Segment&){}
  void setMode(uint8_t value,bool){mode=value;}
  void setName(const char* value){name=value;}
  void setGeometry(uint16_t a,uint16_t b,uint8_t,uint8_t,uint16_t,uint16_t,uint16_t,uint8_t){start=a;stop=allocationFailure?0:b;stateChanged=true;}
};
struct StripMock {
  std::vector<Segment> segments{{0,30},{30,60}};
  bool isMatrix=false;unsigned main=0,length=60;
  unsigned getSegmentsNum(){return segments.size();}
  Segment& getSegment(unsigned id){return segments.at(id);}
  Segment& getMainSegment(){return segments.at(main);}
  unsigned getMaxSegments(){return MAX_NUM_SEGMENTS;}
  unsigned getLengthTotal(){return length;}
  bool isServicing(){return false;}
  void replaceCastleTekSegments(std::vector<Segment>& other){segments.swap(other);if(main>=segments.size()||!segments[main].isActive())main=0;}
  void trigger(){}
} strip;
struct Bus {
  unsigned start=0,length=60;bool enabled=true,ok=true;
  Bus(unsigned a=0,unsigned b=60):start(a),length(b){}
  unsigned getStart() const{return start;}
  unsigned getLength() const{return enabled?length:0;}
  bool isEnabled() const{return enabled;}
  bool isOk() const{return ok;}
};
struct BusManager {
  static std::vector<Bus> buses;
  static unsigned getNumBusses(){return buses.size();}
  static Bus* getBus(unsigned id){return &buses.at(id);}
};
std::vector<Bus> BusManager::buses{{}};
unsigned updates=0;
void stateUpdated(int mode){assert(mode==CALL_MODE_DIRECT_CHANGE);++updates;}
