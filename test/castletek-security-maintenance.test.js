const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  let depth = 0, end = source.indexOf('{', start);
  do {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  } while (depth);
  return source.slice(start, end);
}

test('production security handling preserves installed policy and retains only canonical PIN unlock', () => {
  const server = read('wled00/wled_server.cpp');
  const set = read('wled00/set.cpp');
  const route = functionSource(server, 'static bool castleTekWLEDIsUnavailableSettingsPage(');
  // Execute the production admission path through PIN unlock. The remaining
  // ordinary settings-save path is a sentinel: unlock must never reach it.
  const admission = server.slice(server.indexOf('void serveSettings(AsyncWebServerRequest*'),
    server.indexOf('    bool applySettingsMutation =')) + '    mutations++;\n  }\n}\n';
  const security = set.slice(set.indexOf('  //SECURITY'), set.indexOf('  #ifdef WLED_ENABLE_DMX // include only if DMX is enabled'));
  const metadataStart = server.indexOf('  byte subPage = request->arg(F("p")).toInt();');
  const metadata = server.slice(metadataStart, server.indexOf('  AsyncResponseStream *response', metadataStart));
  const constants = read('wled00/const.h').split('\n').filter(line => /^#define SUBPAGE_/.test(line)).join('\n');
  const scaffold = `
#include <algorithm>
#include <cassert>
#include <cstring>
#include <map>
#include <string>
#include <iostream>
#define F(x) x
#define FPSTR(x) x
#define PSTR(x) x
#define WLED_WIFI_CONFIGURED true
#define PIN_RETRY_COOLDOWN 3000
${constants}
using byte = unsigned char;
struct String : std::string {
  using std::string::string;
  String(const std::string& s) : std::string(s) {}
  int indexOf(const char* s) const { auto i = find(s); return i == npos ? -1 : int(i); }
  bool startsWith(const char* s) const { return rfind(s, 0) == 0; }
  void toLowerCase() { std::transform(begin(), end(), begin(), [](unsigned char c) { return std::tolower(c); }); }
  int toInt() const { return std::atoi(c_str()); }
};
using IPAddress = int;
struct Client { IPAddress remoteIP() { return 1; } };
struct AsyncWebServerRequest {
  String address;
  std::map<std::string, String> fields;
  int status = 0;
  bool hasArg(const char* key) { return fields.count(key); }
  const String& arg(const char* key) { return fields[key]; }
  const String& url() { return address; }
  Client* client() { static Client c; return &c; }
  void send(int code, const char*, const char*) { status = code; }
  void send_P(int code, const char* type, const char* text) { send(code, type, text); }
};
const char *CONTENT_TYPE_PLAIN = "text/plain", *CONTENT_TYPE_JAVASCRIPT = "text/javascript";
const char *s_not_found = "Not found", *s_accessdenied = "Denied", *s_unlock_ota = "Unlock", *s_redirecting = "Redirect";
bool correctPIN = true, wifiLock = false, otaLock = false, aOtaEnabled = false, otaSameSubnet = false, doReboot = false, local = true;
char settingsPIN[5] = "", otaPass[33] = "";
unsigned long lastEditTime = 0, now = 10000;
int mutations = 0, metadataResponses = 0;
unsigned long millis() { return now; }
bool inLocalSubnet(IPAddress) { return local; }
void serveMessage(AsyncWebServerRequest* r, int code, const char*, const char*, int) { r->status = code; }
int defaultLayoutResets=0;
void castleTekWLEDPrepareDefaultLayoutFactoryReset(){++defaultLayoutResets;}
int presetNameResets=0;
void castleTekWLEDPreparePresetNameFactoryReset(){++presetNameResets;}
struct Filesystem { int formats = 0; void format() { formats++; } } WLED_FS;
String castleTekWLEDLegacyPath(const String& path) {
  const std::string base = "/castletek/v1";
  return path.startsWith(base.c_str()) ? String(path.substr(base.size())) : path;
}
${functionSource(read('wled00/util.cpp'), 'void checkSettingsPIN(')}
${route}
${admission}
void settingsMetadata(AsyncWebServerRequest* request) { ${metadata} metadataResponses++; }
void saveSecurity(AsyncWebServerRequest* request) { byte subPage = SUBPAGE_SEC; ${security} }
int main() {
#ifdef CASTLETEK_WLED_COMPAT
  for (const auto* suffix : {"/settings/pins", "/settings/PINS", "/settings/pins/", "/settings/pins/extra", "/settings/xpins"}) {
    for (bool locked : {false, true}) {
      strcpy(settingsPIN, "1357"); correctPIN = !locked;
      AsyncWebServerRequest req; req.address = String("/castletek/v1") + suffix;
      serveSettings(&req, false); assert(req.status == 404);
      if (std::string(suffix) != "/settings/pins") { req.status = 0; serveSettings(&req, true); assert(req.status == 404); }
    }
  }
  for (const auto* page : {"3", "8", "10", "11"}) {
    AsyncWebServerRequest req; req.fields["p"] = page;
    correctPIN = false; settingsMetadata(&req); assert(req.status == 404);
  }
  assert(metadataResponses == 0);
  AsyncWebServerRequest unlock; unlock.address = "/castletek/v1/settings/pins";
  strcpy(settingsPIN, "1357"); correctPIN = false; lastEditTime = 0;
  unlock.fields["PIN"] = "2468"; serveSettings(&unlock, true);
  assert(unlock.status == 401 && !correctPIN && mutations == 0);
  unlock.fields["PIN"] = "1357"; serveSettings(&unlock, true);
  assert(unlock.status == 401 && !correctPIN); // cooldown cannot be bypassed
  now += PIN_RETRY_COOLDOWN + 1; local = false; serveSettings(&unlock, true);
  assert(unlock.status == 401 && !correctPIN); // subnet guard remains
  local = true; unlock.fields["RS"] = "on"; unlock.fields["OW"] = "on";
  serveSettings(&unlock, true);
  assert(unlock.status == 200 && correctPIN && mutations == 0 && WLED_FS.formats == 0 && !wifiLock);
  assert(std::string(settingsPIN) == "1357");
  serveSettings(&unlock, true); assert(unlock.status == 200 && mutations == 0);
  unlock.fields["PIN"] = "2468"; serveSettings(&unlock, true);
  assert(unlock.status == 401 && !correctPIN && mutations == 0);
  for (const auto* installed : {"", "1357"}) for (bool locked : {false, true}) {
    strcpy(settingsPIN, installed); wifiLock = locked;
    for (const auto* submitted : {"", "0000", "2468"}) {
      AsyncWebServerRequest req; req.fields["PIN"] = submitted; req.fields["OW"] = "on";
      saveSecurity(&req); assert(std::string(settingsPIN) == installed && wifiLock == locked);
      req.fields.clear(); saveSecurity(&req);
      assert(std::string(settingsPIN) == installed && wifiLock == locked);
    }
  }
#else
  AsyncWebServerRequest req; req.fields["PIN"] = "2468"; req.fields["OW"] = "on";
  saveSecurity(&req); assert(std::string(settingsPIN) == "2468" && wifiLock);
  req.fields.clear(); req.fields["PIN"] = ""; saveSecurity(&req);
  assert(!strlen(settingsPIN) && !wifiLock);
#endif
  AsyncWebServerRequest reset; reset.fields["RS"] = "on"; saveSecurity(&reset);
  assert(WLED_FS.formats == 1 && doReboot);
#ifdef CASTLETEK_WLED_COMPAT
  assert(defaultLayoutResets == 1 && presetNameResets == 1);
#endif
  std::cout << "Security policy and route checks passed\\n";
}
`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-security-'));
  try {
    const source = path.join(tmp, 'security.cpp'), binary = path.join(tmp, 'security');
    fs.writeFileSync(source, scaffold);
    for (const flags of [[], ['-DCASTLETEK_WLED_COMPAT']]) {
      const compiled = spawnSync(process.env.CXX || 'c++', ['-std=c++17', ...flags, source, '-o', binary], {encoding: 'utf8', timeout: 60000});
      assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
      const ran = spawnSync(binary, [], {encoding: 'utf8', timeout: 15000});
      assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    }
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
});
