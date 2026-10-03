// Host-only platform fakes for the production OTA lifecycle. SHA-256 uses the
// host crypto library; flash/activation and transport callbacks are recorded.
#include <algorithm>
#include <array>
#include <atomic>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <new>
#include <string>
#include <vector>
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
using CC_SHA256_CTX = SHA256_CTX;
using CC_LONG = unsigned long;
#define CC_SHA256 SHA256
#define CC_SHA256_Init SHA256_Init
#define CC_SHA256_Update SHA256_Update
#define CC_SHA256_Final SHA256_Final
#endif
#include "src/dependencies/json/ArduinoJson-v6.h"
#define CASTLETEK_WLED_COMPAT
#define ARDUINO_ARCH_ESP32
#define WLED_WATCHDOG_TIMEOUT 1
#define CASTLETEK_WLED_COMPAT_BASE_PATH "/castletek/v1"
#define F(value) value
#define ESP_OK 0
#define U_FLASH 0
class String : public std::string {
public:
 using std::string::string;
 String(const std::string& v):std::string(v){}
 bool equalsIgnoreCase(const char* other)const {return strcasecmp(c_str(),other)==0;}
};
struct AsyncWebHeader {
 String key,val;
 const String& name()const{return key;}
 const String& value()const{return val;}
};
struct FakeClient {uint32_t timeout=0;void setRxTimeout(uint32_t n){timeout=n;}};
struct AsyncWebServerRequest {
 void* _tempObject=nullptr;
 std::vector<AsyncWebHeader> fields;
 size_t length=0,parameters=0;
 String route="/castletek/v1/update",response;
 int status=0,sends=0;
 FakeClient socket;
 std::function<void()> disconnected;
 ~AsyncWebServerRequest(){disconnect();}
 void disconnect(){if(disconnected){auto fn=std::move(disconnected);disconnected={};fn();}}
 void onDisconnect(std::function<void()> fn){disconnected=fn;}
 FakeClient* client(){return &socket;}
 size_t headers()const{return fields.size();}
 const AsyncWebHeader* getHeader(size_t i)const{return &fields.at(i);}
 String url()const{return route;}
 size_t contentLength()const{return length;}
 size_t params()const{return parameters;}
 void send(int code,const char*,const String& body){status=code;response=body;sends++;}
 void set(const char* key,const std::string& value){erase(key);fields.push_back({key,value});}
 void erase(const char* key){fields.erase(std::remove_if(fields.begin(),fields.end(),[&](const auto& h){return h.key.equalsIgnoreCase(key);}),fields.end());}
};
struct esp_partition_t {size_t address,size;};
static esp_partition_t nextPartition{0x190000,0x180000},runningPartition{0x10000,0x180000};
static bool partitionAvailable=true,doReboot=false;
static uint32_t clockNow=100;
static int sdkHashCalls=0;
uint32_t millis(){return clockNow;}
const esp_partition_t* esp_ota_get_next_update_partition(void*){return partitionAvailable?&nextPartition:nullptr;}
const esp_partition_t* esp_ota_get_running_partition(){return &runningPartition;}
int esp_partition_get_sha256(const esp_partition_t*,uint8_t* digest){sdkHashCalls++;memset(digest,0x42,32);return 0;}
using mbedtls_sha256_context=CC_SHA256_CTX;
static bool failHashStart=false,failHashUpdate=false,failHashFinish=false;
void mbedtls_sha256_init(mbedtls_sha256_context* c){memset(c,0,sizeof(*c));}
void mbedtls_sha256_free(mbedtls_sha256_context*){}
int mbedtls_sha256_starts_ret(mbedtls_sha256_context* c,int){return failHashStart?-1:CC_SHA256_Init(c)==1?0:-1;}
int mbedtls_sha256_update_ret(mbedtls_sha256_context* c,const uint8_t* p,size_t n){return failHashUpdate?-1:CC_SHA256_Update(c,p,CC_LONG(n))==1?0:-1;}
int mbedtls_sha256_finish_ret(mbedtls_sha256_context* c,uint8_t* p){return failHashFinish?-1:CC_SHA256_Final(p,c)==1?0:-1;}
int mbedtls_sha256_ret(const uint8_t* p,size_t n,uint8_t* out,int){return CC_SHA256(p,CC_LONG(n),out)?0:-1;}
struct FakeUpdate {
 bool running=false,failBegin=false,failWrite=false,failEnd=false;
 int begins=0,writes=0,ends=0,aborts=0;size_t expected=0;
 std::vector<uint8_t> bytes;
 bool isRunning(){return running;}
 bool begin(size_t n,int){begins++;expected=n;running=!failBegin;return running;}
 size_t write(uint8_t* p,size_t n){writes++;if(failWrite)return 0;bytes.insert(bytes.end(),p,p+n);return n;}
 bool end(bool partial){ends++;if(partial||bytes.size()!=expected||failEnd)return false;running=false;return true;}
 void abort(){aborts++;running=false;}
} Update;
struct FakeStrip {int suspends=0,resumes=0,resets=0;void suspend(){suspends++;}void resume(){resumes++;}void resetSegments(){resets++;}} strip;
static int usermodOn=0,usermodOff=0,watchdogOn=0,watchdogOff=0,backups=0,bootChecks=0;
struct UsermodManager {static void onUpdateBegin(bool on){if(on)usermodOn++;else usermodOff++;}};
struct WLED {static WLED& instance(){static WLED v;return v;}void enableWatchdog(){watchdogOn++;}void disableWatchdog(){watchdogOff++;}};
void backupConfig(){backups++;}
void bootloopCheckOTA(){bootChecks++;}
struct wled_metadata_t {uint8_t bytes[119];};
static int metadataCalls=0;
static bool allowMetadata=true;
static std::vector<uint8_t> seenMetadata;
bool findWledMetadata(const uint8_t* p,size_t n,wled_metadata_t* out){metadataCalls++;seenMetadata.assign(p,p+n);if(n!=119||memcmp(p,"STSW",4))return false;memcpy(out,p,n);return true;}
bool shouldAllowOTA(const wled_metadata_t& m,char*,size_t){return allowMetadata&&m.bytes[115]==1;}
static const std::string testKey(64,'a');
static constexpr size_t castleTekUpdateKeyLength=64;
static uint8_t castleTekUpdateKeyDigest[32];
