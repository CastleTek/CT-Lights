const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const between = (source, start, end) => {
 const a=source.indexOf(start), b=source.indexOf(end,a);
 assert.ok(a>=0 && b>a, `production block missing: ${start}`); return source.slice(a,b);
};
test('actual WiFi policy, station form handling and boot paths preserve setup and existing networks', () => {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'castletek-wifi-'));
 try {
  const cfg=read('wled00/cfg.cpp'), set=read('wled00/set.cpp');
  const struct=between(read('wled00/fcn_declare.h'),'typedef struct WiFiConfig {','//dmx_output.cpp');
  const policy=read('wled00/castletek_wled_wifi.cpp').replace('#include "wled.h"','');
  const defaults=between(cfg,'  #ifdef CASTLETEK_WLED_COMPAT\n  if (fromFS) needsSave','  //int rev_major');
  const stations=between(cfg,'  size_t n = 0;\n  JsonArray nw_ins = nw["ins"];','  JsonArray dns = nw[F("dns")];');
  const ap=between(cfg,'  #ifndef CASTLETEK_WLED_COMPAT\n  JsonObject ap = doc["ap"];','  JsonObject hw = doc[F("hw")];');
  const secrets=between(cfg,'  #ifdef CASTLETEK_WLED_COMPAT\n  castleTekWLEDApplyWiFiDefaults();\n  #else\n  JsonObject ap = root["ap"];','  [[maybe_unused]] JsonObject interfaces = root["if"];');
  const form=between(set,'  //WIFI SETTINGS','  //LED SETTINGS');
  const metadata=between(read('wled00/xml.cpp'),'    #ifdef CASTLETEK_WLED_COMPAT\n    settingsScript.printf_P(PSTR("resetWiFi(%u);")','    for (size_t n = 0; n < multiWiFi.size(); n++)');
  const asterisks=between(read('wled00/util.cpp'),'bool isAsterisksOnly(', '\n/*');
  const mac=between(read('wled00/network.cpp'),'void fillStr2MAC(', '\n\n// performs');
  const checkOrder=set.indexOf('castleTekWLEDValidateSettings(request, subPage)');
  assert.ok(checkOrder>0 && checkOrder<set.indexOf('//WIFI SETTINGS'));
  assert.match(read('wled00/wled.cpp'),/void WLED::initAP\(bool resetAP\)\s*\{\s*#ifdef CASTLETEK_WLED_COMPAT\s*castleTekWLEDApplyWiFiDefaults\(\)/);
  const source=read('test/fixtures/castletek-wifi-policy-host.h').replace('// PRODUCTION_WIFI_CONFIG',struct)+'\n'+policy+'\n'+asterisks+'\n'+mac+`
#define PSTR(value) value
static unsigned hostMetadataMaximum() {
 struct { unsigned count=0; void printf_P(const char*,unsigned value) {count=value;} } settingsScript;
${metadata}
 return settingsScript.count;
}
static int hostConfig(JsonObject doc, bool fromFS) {
 if (!fromFS && !castleTekWLEDValidateWiFiConfig(doc)) return -1;
 bool needsSave = false;
${defaults}
 JsonObject nw=doc["nw"];
${stations}
${ap}
 return needsSave;
}
static void hostSecrets(JsonObject root) {
 (void)root;
${secrets}
}
static void hostOpenAP() { castleTekWLEDApplyWiFiDefaults(); }
static bool hostSettings(AsyncWebServerRequest& value) {
 auto* request=&value; const byte subPage=SUBPAGE_WIFI;
 if (!castleTekWLEDValidateWiFiSettings(request)) return false;
${form}
 return true;
}
`+read('test/fixtures/castletek-wifi-policy-host.cpp');
  fs.writeFileSync(path.join(temp,'wifi.cpp'),source);
  const binary=path.join(temp,'wifi');
  const compiled=spawnSync(process.env.CXX||'c++',['-std=c++17','-Wall','-Wextra','-Werror','-DCASTLETEK_WLED_COMPAT','-DARDUINO_ARCH_ESP32','-DWLED_DISABLE_ESPNOW','-I',path.join(root,'wled00'),path.join(temp,'wifi.cpp'),'-o',binary],{encoding:'utf8',timeout:60000});
  assert.equal(compiled.status,0,compiled.stderr||String(compiled.error));
  const ran=spawnSync(binary,[],{encoding:'utf8',timeout:10000});
  assert.equal(ran.status,0,ran.stderr||String(ran.error));assert.match(ran.stdout,/WiFi checks passed: \d+/);process.stdout.write(ran.stdout);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

function page(compatibility) {
 const ids={}, controls={};
 const entries=[];
 ids.wifi_entries={children:entries,childNodes:entries,insertAdjacentHTML(position,html){
  const node={html,remove(){entries.splice(entries.indexOf(node),1);}}; entries.push(node);
 }};
 for(const id of ['wifi_add','wifi_rem'])ids[id]={style:{},remove(){delete ids[id];}};
 for(const [id,names] of [['ct_ap_settings',['AS','AP','AH','AB','AC']],['ct_force_g',['FG']],['ct_wifi_radio',['RE','RM0']]]) {
  const fields=names.map(name=>controls[name]={name,value:'',disabled:false});
  ids[id]={hidden:false,querySelectorAll(){return fields;}};
 }
 const document={Sf:{},head:{appendChild(){}},createElement(){return {};},getElementById(id){return ids[id];}};
 const ctx=vm.createContext({document,d:document,window:{},gId:id=>ids[id],isCastleTekWLEDCompat:()=>compatibility,getLoc(){},loadJS(){},getURL:value=>value,setTimeout(){},loc:false});
 vm.runInContext(read('wled00/data/settings_wifi.htm').match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
 ctx.S();return {ctx,ids,entries,controls};
}
test('Compatibility removes profile addition and hides AP/force-g controls without breaking metadata or existing profile removal',()=>{
 const p=page(true);
 assert.equal(p.ids.wifi_add,undefined);
 assert.equal(p.ids.ct_ap_settings.hidden,true);assert.equal(p.ids.ct_force_g.hidden,true);assert.equal(p.ids.ct_wifi_radio.hidden,true);
 for(const field of Object.values(p.controls))assert.equal(field.disabled,true);
 p.ctx.resetWiFi(1);p.ctx.addWiFi('Home','********');p.ctx.addWiFi('Extra');assert.equal(p.entries.length,1);
 p.ctx.resetWiFi(2);p.ctx.addWiFi('Home','********');p.ctx.addWiFi('Legacy','********');
 assert.equal(p.entries.length,2);assert.match(p.entries[0].html,/name="CS0"/);assert.match(p.entries[1].html,/name="CS1"/);
 p.ctx.addWiFi('Extra');assert.equal(p.entries.length,2);
 p.ctx.remWiFi();assert.equal(p.entries.length,1);
 assert.equal(p.ids.wifi_rem.style.display,'none');
 assert.match(read('wled00/data/settings_wifi.htm'),/Save & Connect/);
});
test('stock WiFi page retains network addition and AP/force-g controls',()=>{
 const p=page(false);
 assert.ok(p.ids.wifi_add);assert.equal(p.ids.ct_ap_settings.hidden,false);assert.equal(p.ids.ct_force_g.hidden,false);assert.equal(p.ids.ct_wifi_radio.hidden,false);
 for(const field of Object.values(p.controls))assert.equal(field.disabled,false);
 p.ctx.resetWiFi(3);p.ctx.addWiFi('Home');p.ctx.addWiFi('Second');assert.equal(p.entries.length,2);
 assert.equal(p.ids.wifi_add.style.display,'inline');
});
