#include <algorithm>
#include <array>
#include <cassert>
#include <cctype>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "src/dependencies/json/ArduinoJson-v6.h"
#define CASTLETEK_WLED_COMPAT
#define MAX_NUM_SEGMENTS 32
#define DMX_MODE_DISABLED 0
#define JSON_LOCK_SERVER 1
#define HTTP_GET 1
#define HTTP_POST 2
#define F(v) v
#define PSTR(v) v
using byte = uint8_t;
class String : public std::string {
public:
  using std::string::string;
  String(const std::string& s):std::string(s){}
  bool isEmpty() const { return empty(); }
  int toInt() const { return std::atoi(c_str()); }
  void toLowerCase() { for (char& c:*this) c=std::tolower(c); }
  void replace(const char* from,const char* to) { size_t at; while((at=find(from))!=npos) std::string::replace(at,strlen(from),to); }
};
size_t strlcpy(char* out,const char* in,size_t n) { if(n){size_t len=std::min(strlen(in),n-1);memcpy(out,in,len);out[len]=0;}return strlen(in); }
char* strlwr(char* text) { for(char* p=text;*p;p++)*p=std::tolower(*p);return text; }
class Print {
public:
  std::string value;
  size_t write(uint8_t c){value+=char(c);return 1;}
  size_t write(const uint8_t* p,size_t n){value.append((const char*)p,n);return n;}
  void print(const char* s){value+=s;}
  void printf_P(const char* fmt,...){char buf[1024];va_list args;va_start(args,fmt);vsnprintf(buf,sizeof(buf),fmt,args);va_end(args);value+=buf;}
};
size_t printSetFormCheckbox(Print& out,const char* key,int value){out.printf_P("d.Sf.%s.checked=%d;",key,value);return 1;}
uint32_t clockNow=10000; uint32_t millis(){return clockNow;}
using portMUX_TYPE=int;
static int criticalDepth=0;
#define portMUX_INITIALIZER_UNLOCKED 0
#define portENTER_CRITICAL(v) do{(void)(v);assert(criticalDepth++==0);}while(false)
#define portEXIT_CRITICAL(v) do{(void)(v);assert(--criticalDepth==0);}while(false)
constexpr int ESP_MAC_WIFI_SOFTAP=1;
size_t factoryAPReads=0;
int esp_read_mac(uint8_t* data,int type){assert(type==ESP_MAC_WIFI_SOFTAP);++factoryAPReads;const uint8_t mac[]={2,0x11,0x22,0x33,0x44,0x51};memcpy(data,mac,6);return 0;}
constexpr int WL_CONNECTED = 3;
struct WifiMock {
  bool connected = true;
  int currentChannel = 6;
  int status() const { return connected ? WL_CONNECTED : 0; }
  bool apMACAvailable=false;
  String macAddress(){return "02:11:22:33:44:50";}
  void macAddress(uint8_t* data){const uint8_t mac[]={2,0x11,0x22,0x33,0x44,0x50};memcpy(data,mac,6);}
  String softAPmacAddress(){return apMACAvailable?"02:11:22:33:44:51":"";}
  void softAPmacAddress(uint8_t* data){if(apMACAvailable){const uint8_t mac[]={2,0x11,0x22,0x33,0x44,0x51};memcpy(data,mac,6);}}
  int channel(){return currentChannel;}
} WiFi;
bool apActive=false, correctPIN=true, configNeedsWrite=false, backupFailed=false, locked=false, forceReconnect=false;
char settingsPIN[8]={}; uint32_t lastEditTime=0;
#ifndef WLED_DISABLE_ESPNOW
bool enableESPNow=false;
uint8_t statusESPNow=1;
#endif
bool useESPNowSync=false,receiveNotificationPowerOnly=false,sendNotifications=false,sendNotificationsRT=false,notifyDirect=true;
using IPAddress=uint32_t;
bool udpConnected=true;
uint16_t udpPort=21324,udpPort2=65506,ntpLocalPort=2390,udpRgbPort=19446,realtimeTimeoutMs=2500;
constexpr unsigned DDP_DEFAULT_PORT=4048;
bool udp2Connected=true,nodeListEnabled=true,nodeBroadcastEnabled=true,receiveDirect=true,useMainSegmentOnly=false;
bool realtimeRespectLedMaps=true,arlsForceMaxBri=false,arlsDisableGammaCorrection=true;
int arlsOffset=0;
std::map<unsigned,unsigned> Nodes;
struct NetworkMock { bool isConnected(){return WiFi.connected;} uint32_t subnetMask(){return 0x00ffffff;} uint32_t gatewayIP(){return 0x0114a8c0;} } Network;
struct UDPmock {
  size_t begins=0,ends=0; bool beginResult=true; uint32_t address=0; uint16_t port=0; std::vector<uint8_t> data;
  size_t binds=0,stops=0; uint16_t boundPort=0;
  bool begin(uint16_t p){assert(!criticalDepth);++binds;boundPort=p;return beginResult;}
  void stop(){assert(!criticalDepth);++stops;boundPort=0;}
  bool beginPacket(IPAddress ip,uint16_t p){assert(!criticalDepth);++begins;address=ip;port=p;data.clear();return beginResult;}
  size_t write(const uint8_t* p,size_t n){assert(!criticalDepth);data.insert(data.end(),p,p+n);return n;}
  bool endPacket(){assert(!criticalDepth);++ends;return true;}
} notifierUdp,notifier2Udp;
bool receiveNotificationBrightness=true,receiveNotificationColor=true,receiveNotificationEffects=true,receiveNotificationPalette=true,receiveSegmentOptions=false,receiveSegmentBounds=false,notifyButton=true,notifyHue=true;
uint8_t syncGroups=1,receiveGroups=1,udpNumRetries=0,DMXMode=4;
std::vector<std::array<char,13>> linked_remotes;
DynamicJsonDocument document(8192); DynamicJsonDocument* pDoc=&document;
size_t jsonLockRequests=0;
bool requestJSONBufferLock(int,int=250){++jsonLockRequests;if(locked)return false;locked=true;return true;}
void releaseJSONBufferLock(){assert(locked);locked=false;}
bool castleTekWLEDBackupFailed(){return backupFailed;}
String castleTekWLEDRoute(const char* p){return String("/castletek/v1")+p;}
struct AsyncJsonResponse {
  DynamicJsonDocument doc; int status=200;
  AsyncJsonResponse(size_t size):doc(size){}
  JsonObject getRoot(){return doc.to<JsonObject>();}
  void setCode(int n){status=n;}
  void addHeader(const char*, const char*){}
  void setLength(){}
};
struct AsyncWebServerRequest {
  void* _tempObject=nullptr; int status=0; std::string response,body; std::map<std::string,std::string> fields;
  String requestURL="/castletek/v1/sync";
  size_t contentLength(){return body.size();}
  String url(){return requestURL;}
  void send(int n){status=n;}
  void send(AsyncJsonResponse* r){status=r->status;serializeJson(r->doc,response);delete r;}
  bool hasArg(const char* key){return fields.count(key);}
  String arg(const char* key){return fields[key];}
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
