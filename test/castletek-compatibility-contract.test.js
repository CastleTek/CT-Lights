const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const manifest = JSON.parse(read("castletek/compatibility-v1/routes.json"));

const inlineScripts = source => [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(sourceText => sourceText.trim());

test("compatibility identity is separate from stock and authenticated CastleTek", () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.basePath, "/castletek/v1");
  assert.equal(manifest.webSocketPath, "/castletek/v1/ws");
  assert.equal(manifest.defaultFriendlyName, "CastleTek Controller");
  assert.equal(manifest.discovery.bonjourType, "_castletek-wled._tcp");
  assert.equal(manifest.discovery.hostPrefix, "castletek-");
  assert.equal(manifest.discovery.txt.auth, "none");
  assert.notEqual(manifest.discovery.bonjourType, "_wled._tcp");
  assert.notEqual(manifest.discovery.bonjourType, manifest.reservedAuthenticatedCastleTekSurfaces.bonjourType);
  assert.notEqual(manifest.basePath, manifest.reservedAuthenticatedCastleTekSurfaces.apiBase);
  assert.deepEqual(manifest.retiredBasePaths, [{
    basePath: "/castletek-wled/v1",
    behavior: "404-no-redirect"
  }]);
});

test("compatibility identity replaces only stock-generated friendly-name and mDNS defaults", () => {
  const compatibility = read("wled00/castletek_wled_compat.h");
  const header = read("wled00/wled.h");
  const main = read("wled00/wled.cpp");

  assert.match(compatibility, /CASTLETEK_WLED_COMPAT_DEFAULT_NAME "CastleTek Controller"/);
  assert.match(compatibility, /CASTLETEK_WLED_COMPAT_MDNS_PREFIX "castletek-"/);
  assert.match(header, /!defined\(SERVERNAME\) && defined\(CASTLETEK_WLED_COMPAT\)/);
  assert.match(header, /#define SERVERNAME CASTLETEK_WLED_COMPAT_DEFAULT_NAME/);
  assert.match(main, /strcmp\(serverDescription, "WLED"\) == 0/);
  assert.match(main, /strcmp\(cmDNS, DEFAULT_MDNS_NAME\) == 0 \|\| strcmp\(cmDNS, legacyDefaultMDNS\) == 0/);
  assert.match(main, /CASTLETEK_WLED_COMPAT_MDNS_PREFIX "%\*s"/);
  assert.match(main, /needsCfgSave = true/);
});

test("every compatibility HTTP route is namespaced", () => {
  for (const family of manifest.routeFamilies) {
    if (family.prefix) {
      for (const legacyPath of family.legacy) {
        assert.ok(`${family.prefix}${legacyPath}`.startsWith(`${manifest.basePath}/`));
      }
    }
    for (const route of family.namespaced || []) {
      assert.ok(route.startsWith(`${manifest.basePath}/`));
    }
    if (family.namespacedPrefix) {
      assert.ok(family.namespacedPrefix.startsWith(`${manifest.basePath}/`));
    }
    for (const route of family.methodScoped || []) {
      assert.ok(route.namespaced.startsWith(`${manifest.basePath}/`));
    }
  }
});

test("compatibility settings omit UI, 2D, and Usermods pages without breaking CastleTek rename clients", () => {
  const settingsFamily = manifest.routeFamilies.find(family => family.name === "settings");
  assert.ok(settingsFamily);
  assert.ok(!settingsFamily.legacy.includes("/settings/ui"));
  assert.ok(!settingsFamily.legacy.includes("/settings/2D"));
  assert.ok(!settingsFamily.legacy.includes("/settings/um"));
  assert.ok(!manifest.routeFamilies.find(family => family.name === "web-utilities").legacy.includes("/u"));
  assert.deepEqual(manifest.disabledSettingsSurfaces.find(surface => surface.path.endsWith("/s.js")).blockedQueryValues.p, [3, 8, 10, 11]);
  assert.equal(manifest.hardwarePolicy.usermodsEditable, false);
  assert.ok(!settingsFamily.legacy.includes("/settings/pins"));
  assert.deepEqual(settingsFamily.methodScoped, [{
    legacy: "/settings/ui",
    namespaced: "/castletek/v1/settings/ui",
    allowedMethods: ["POST"],
    blockedMethods: ["GET"],
    reason: "The native app and CastleTek controller shell retain the WLED-shaped rename mutation; the browser settings page is removed."
  }, {
    legacy: "/settings/pins", namespaced: "/castletek/v1/settings/pins",
    allowedMethods: ["POST"], blockedMethods: ["GET"],
    reason: "The native app retains PIN unlock for existing security settings; the Pin Info browser page is removed."
  }]);
  assert.deepEqual(manifest.disabledSettingsSurfaces.map(surface => surface.path), [
    "/castletek/v1/settings/ui",
    "/castletek/v1/settings/2D",
    "/castletek/v1/settings/um",
    "/castletek/v1/u",
    "/castletek/v1/settings/pins",
    "/castletek/v1/settings/s.js"
  ]);

  const settings = read("wled00/data/settings.htm");
  assert.match(settings, /gId\('2dbtn'\)\?\.remove\(\)/);
  assert.match(settings, /gId\('uibtn'\)\?\.remove\(\)/);
  assert.match(settings, /document\.readyState === 'loading'/);
  assert.match(settings, /DOMContentLoaded/);

  const server = read("wled00/wled_server.cpp");
  assert.match(server, /castleTekWLEDIsUnavailableSettingsPage\(const String& requestPath, bool allowCanonicalPost\)/);
  assert.match(server, /isCanonicalUIPost = allowCanonicalPost && logicalPath == F\("\/settings\/ui"\)/);
  assert.match(server, /return is2D \|\| \(isUI && !isCanonicalUIPost\)/);
  assert.match(server, /if \(subPage == SUBPAGE_UI \|\| subPage == SUBPAGE_2D \|\| subPage == SUBPAGE_UM \|\| subPage == SUBPAGE_PINS\)[\s\S]*?request->send\(404/);
  assert.match(server, /castleTekWLEDIsUnavailableSettingsPage\(url, post\)/);
  assert.match(server, /logicalSettingsPath = castleTekWLEDLegacyPath\(url\)/);
  assert.match(server, /isCanonicalUIPost = post && logicalSettingsPath == F\("\/settings\/ui"\)/);
  assert.match(server, /subPage == SUBPAGE_2D \|\| \(subPage == SUBPAGE_UI && !isCanonicalUIPost\)/);
  const parserGuard = server.indexOf("const String logicalSettingsPath");
  const pinGate = server.indexOf("bool pinRequired", parserGuard);
  const mutation = server.indexOf("handleSettingsSet(request, subPage)", parserGuard);
  assert.ok(parserGuard >= 0 && parserGuard < pinGate && pinGate < mutation);
  assert.match(server, /#ifndef CASTLETEK_WLED_COMPAT\s+case SUBPAGE_UI/);
  assert.match(server, /!defined\(WLED_DISABLE_2D\) && !defined\(CASTLETEK_WLED_COMPAT\)\s+case SUBPAGE_2D/);
});

test("firmware registers routes through the compatibility router and guards fallback first", () => {
  const server = read("wled00/wled_server.cpp");
  const routedRegistrations = server.match(/server\.on\(castleTekWLEDRoute/g) || [];
  assert.ok(routedRegistrations.length >= 25, `found only ${routedRegistrations.length} routed registrations`);
  assert.match(server, /AsyncCallbackJsonWebHandler\(castleTekWLEDRoute/);
  assert.match(server, /server\.on\(castleTekWLEDRoute\("\/"\)/);
  assert.match(server, /server\.on\(castleTekWLEDRoute\(F\("\/control"\)\)/);
  assert.match(server, /!request->_tempObject && request->hasArg\(F\("PIN"\)\)/);
  assert.match(server, /!correctPIN && strlen\(settingsPIN\) > 0/);
  assert.match(server, /serveSettings\(request, true\)[\s\S]*serveSettings\(request\)/);

  const notFound = server.slice(server.indexOf("server.onNotFound"));
  const guard = notFound.indexOf("castleTekWLEDIsNamespacedRoute");
  const command = notFound.indexOf("handleSet(request, logicalPath)");
  const fileRead = notFound.indexOf("handleStaticContent(request, logicalPath");
  assert.ok(guard >= 0 && guard < command && command < fileRead);
  assert.match(notFound, /castleTekWLEDIsSafeLegacyPath\(logicalPath\)/);
});

test("controller-shell rename tokens deduplicate transparent HTTP transport retries", () => {
  const server = read("wled00/wled_server.cpp");
  assert.match(server, /castleTekWLEDShouldApplyUIRequest\(AsyncWebServerRequest\* request\)/);
  assert.match(server, /request->hasArg\(F\("CTRID"\)\)/);
  assert.match(server, /!strcmp\(castleTekWLEDLastUIRequestId, requestId\.c_str\(\)\)/);
  assert.match(server, /subPage == SUBPAGE_UI && isCanonicalUIPost/);
  assert.match(server, /if \(applySettingsMutation\)\s*\{\s*bool applied = handleSettingsSet\(request, subPage\);/);
});

test("WebSocket, JSON dispatch, and Bonjour use the compatibility contract", () => {
  const header = read("wled00/wled.h");
  const json = read("wled00/json.cpp");
  const main = read("wled00/wled.cpp");
  assert.match(header, /CASTLETEK_WLED_COMPAT_BASE_PATH "\/ws"/);
  assert.match(json, /castleTekWLEDLegacyPath\(request->url\(\)\)/);
  assert.match(main, /MDNS\.addService\(CASTLETEK_WLED_COMPAT_MDNS_SERVICE/);
  assert.match(main, /"profile", CASTLETEK_WLED_COMPAT_PROFILE/);
  assert.match(main, /"auth", "none"/);
});

test("built web clients do not bypass route construction", () => {
  const common = read("wled00/data/common.js");
  const editor = read("wled00/data/edit.htm");
  const message = read("wled00/data/msg.htm");
  const notFound = read("wled00/data/404.htm");
  const pin = read("wled00/data/settings_pin.htm");
  const shell = read("wled00/data/castletek-control.js");
  const updater = read("wled00/data/update.htm");

  assert.match(common, /req\.open\("POST", getURL\("\/upload"\)\)/);
  assert.doesNotMatch(common, /req\.open\("POST", "\/upload"\)/);
  assert.doesNotMatch(editor, /req\.add\("(?:GET|POST)", "\/(?:edit|upload)"/);
  assert.match(shell, /const namespace = "\/castletek\/v1"/);
  assert.match(shell, /prefix === "\/api" \|\| prefix\.endsWith\("\/api"\)/);
  assert.match(shell, /end === path\.length \|\| path\.charAt\(end\) === "\/"/);
  assert.match(shell, /route\("\/ws"\)/);
  assert.match(shell, /requestJSON\("\/json\/state"/);
  assert.match(shell, /requestResponse\("\/settings\/ui"[\s\S]*?method:\s*"POST"/,
    "the shell rename must use only the exact retained method-scoped route");
  assert.doesNotMatch(shell, /requestJSON\("\/settings\/ui"/,
    "the WLED HTML save response must be verified through a separate info GET");
  assert.doesNotMatch(shell, /\/castletek-wled\/v1|["']\/settings\/ui["'][\s\S]{0,40}method:\s*"GET"/);
  assert.match(updater, /onload="getLoc\(\);configureUpdatePage\(\);GetV\(\);"/);
  assert.match(updater, /getURL\("\/update\?revert"\)/);
  assert.match(updater, /getURL\('\/json\/info'\)/);
  assert.match(updater, /!isCastleTekWLEDCompat\(\) && data\.repo/);
  assert.match(updater, /gId\("validationOverride"\)\.remove\(\)/);
  assert.match(message, /pathname\.slice\(0, nsIndex\) \+ ns \+ "\/settings"/);
  assert.match(message, /pathname\.slice\(0, nsIndex\) \+ ns \+ "\/"/);
  assert.match(notFound, /pathname\.slice\(0, nsIndex\) \+ ns \+ "\/"/);
  assert.match(pin, /pathname\.slice\(0, i\) \+ ns \+ "\/settings"/);
});

test("auxiliary page navigation resolves through the CastleTek namespace", () => {
  const location = pathname => ({
    protocol: "http:",
    host: "controller.test",
    hostname: "controller.test",
    port: "",
    pathname
  });

  const commonContext = { document: {}, window: { location: location("/proxy/castletek/v1/update") } };
  vm.runInNewContext(read("wled00/data/common.js"), commonContext);
  commonContext.getLoc();
  assert.equal(commonContext.getURL("/json/info"), "http://controller.test/proxy/castletek/v1/json/info");
  assert.equal(commonContext.getURL("/update?revert"), "http://controller.test/proxy/castletek/v1/update?revert");

  const authenticatedContext = { document: {}, window: { location: location("/api/castletek/v1/device") } };
  vm.runInNewContext(read("wled00/data/common.js"), authenticatedContext);
  assert.equal(authenticatedContext.isCastleTekWLEDCompat(), false);

  const proxiedAuthenticatedContext = { document: {}, window: { location: location("/proxy/api/castletek/v1/device") } };
  vm.runInNewContext(read("wled00/data/common.js"), proxiedAuthenticatedContext);
  assert.equal(proxiedAuthenticatedContext.isCastleTekWLEDCompat(), false);

  const boundaryContext = { document: {}, window: { location: location("/castletek/v1evil/json/info") } };
  vm.runInNewContext(read("wled00/data/common.js"), boundaryContext);
  assert.equal(boundaryContext.isCastleTekWLEDCompat(), false);

  const runMessage = pathname => {
    const context = {
      document: { title: "" },
      window: { location: location(pathname), history: { back() {} } },
      top: { location: { href: "" } }
    };
    vm.runInNewContext(inlineScripts(read("wled00/data/msg.htm"))[0], context);
    return context;
  };
  const messageHome = runMessage("/proxy/castletek/v1/update");
  messageHome.RP();
  assert.equal(messageHome.top.location.href, "/proxy/castletek/v1/");
  const messageSettings = runMessage("/proxy/castletek/v1/update");
  messageSettings.RS();
  assert.equal(messageSettings.window.location, "/proxy/castletek/v1/settings");
  const authenticatedMessage = runMessage("/proxy/api/castletek/v1/device");
  authenticatedMessage.RP();
  assert.equal(authenticatedMessage.top.location.href, "../");

  const marks = {
    wledMark: { style: {} },
    castleTekMark: { style: {} },
    notFoundMessage: { textContent: "" }
  };
  const notFoundContext = {
    document: { getElementById: id => marks[id] },
    window: { location: location("/proxy/castletek/v1/missing") }
  };
  vm.runInNewContext(inlineScripts(read("wled00/data/404.htm"))[0], notFoundContext);
  notFoundContext.RP();
  assert.equal(notFoundContext.window.location.href, "/proxy/castletek/v1/");

  let opened = "";
  const pinContext = {
    document: {},
    window: {
      location: location("/proxy/castletek/v1/update"),
      open: value => { opened = value; }
    }
  };
  vm.runInNewContext(inlineScripts(read("wled00/data/settings_pin.htm"))[0], pinContext);
  pinContext.B();
  assert.equal(opened, "/proxy/castletek/v1/settings");
});

test("CastleTek shell is compiled separately from the upstream stock UI", () => {
  const builder = read("tools/cdata.js");
  const server = read("wled00/wled_server.cpp");
  const stockShell = read("wled00/data/index.htm");
  const compatibilityShell = read("wled00/data/castletek.htm");

  assert.match(builder, /castletek\.htm.*html_castletek\.h.*'castletek'/);
  assert.match(server, /#ifdef CASTLETEK_WLED_COMPAT[\s\S]*#include "html_castletek\.h"[\s\S]*#else[\s\S]*#include "html_ui\.h"/);
  assert.match(server, /PAGE_castletek, PAGE_castletek_length/);
  assert.match(stockShell, /<title>WLED<\/title>/);
  assert.match(compatibilityShell, /<title>CastleTek Lights<\/title>/);
});

test("release profiles are branded and do not publish upstream update metadata", () => {
  const config = read("platformio_override.ini");
  assert.match(config, /env:castletek_compat_esp32dev/);
  assert.match(config, /env:castletek_compat_digquad_v2_v3_wifi/);
  assert.match(config, /WLED_REPO=\\"unknown\\"/);
  assert.match(config, /WLED_DISABLE_ALEXA/);
  assert.match(config, /WLED_DISABLE_MQTT/);
  assert.match(config, /WLED_DISABLE_PIXELFORGE/);
  assert.doesNotMatch(config, /WLED_ENABLE_(?:PIXART|PXMAGIC|DMX)/);
  const generic = config.split("[env:castletek_compat_esp32dev]")[1].split("[env:")[0];
  const digQuad = config.split("[env:castletek_compat_digquad_v2_v3_wifi]")[1].split("[env:")[0];
  assert.match(generic, /^\s*-D DATA_PINS=16,17,18,19$/m);
  assert.match(digQuad, /^\s*-D DATA_PINS=16,3,1,4$/m);
});

test("OTA release-name conversion terminates at the bounded content length", () => {
  const metadata = read("wled00/wled_metadata.cpp");
  const conversionStart = metadata.indexOf("static inline String bufToString");
  const conversionEnd = metadata.indexOf("/**", conversionStart);
  assert.ok(conversionStart >= 0 && conversionEnd > conversionStart);

  const conversion = metadata.slice(conversionStart, conversionEnd);
  assert.match(conversion, /size_t real_len = strnlen\(buf, len\);/);
  assert.match(conversion, /memcpy\(sbuf, buf, real_len\);/);
  assert.match(conversion, /sbuf\[real_len\] = '\\0';/);
  assert.doesNotMatch(conversion, /sbuf\[len\] = '\\0';/);
  assert.ok(
    conversion.indexOf("memcpy(sbuf, buf, real_len)") < conversion.indexOf("sbuf[real_len] = '\\0'")
  );
});

test("compiled auxiliary pages keep navigation inside the current namespace", () => {
  const dmxMap = read("wled00/data/dmxmap.htm");
  const dmxSettings = read("wled00/data/settings_dmx.htm");
  const security = read("wled00/data/settings_sec.htm");

  assert.match(dmxMap, /window\.location = "\.\/settings"/);
  assert.match(dmxMap, /top\.location\.href="\.\/"/);
  assert.match(dmxSettings, /getURL\('\/dmxmap'\)/);
  assert.doesNotMatch(security, /href="\.\.\/(?:presets|cfg)\.json"/);
});

test("shared auxiliary pages retain stock defaults and brand only compatibility routes", () => {
  const common = read("wled00/data/common.js");
  const settings = read("wled00/data/settings.htm");
  const palette = read("wled00/data/cpal/cpal.htm");
  const editor = read("wled00/data/edit.htm");
  const live1D = read("wled00/data/liveview.htm");
  const live2D = read("wled00/data/liveviewws2D.htm");
  const message = read("wled00/data/msg.htm");
  const notFound = read("wled00/data/404.htm");
  const welcome = read("wled00/data/welcome.htm");
  const security = read("wled00/data/settings_sec.htm");
  const updater = read("wled00/data/update.htm");
  const ota = read("wled00/ota_update.cpp");
  const ui = read("wled00/data/settings_ui.htm");
  const leds = read("wled00/data/settings_leds.htm");
  const sync = read("wled00/data/settings_sync.htm");

  assert.match(common, /const castleTekWLEDBase = "\/castletek\/v1"/);
  assert.match(common, /const authenticatedCastleTekBase = "\/api\/castletek\/v1"/);
  assert.match(common, /prefix === "\/api" \|\| prefix\.endsWith\("\/api"\)/);
  assert.match(common, /end === path\.length \|\| path\.charAt\(end\) === "\/"/);
  assert.match(common, /function isCastleTekWLEDCompat\(\)/);

  for (const [source, stockTitle, compatibilityTitle] of [
    [settings, "WLED Settings", "CastleTek Controller Settings"],
    [palette, "WLED Palette Editor", "CastleTek Palette Editor"],
    [editor, "WLED File Editor", "CastleTek File Editor"],
    [live1D, "WLED Live Preview", "CastleTek Live Preview"],
    [live2D, "WLED Live Preview", "CastleTek Live Preview"],
    [message, "WLED Message", "CastleTek Message"]
  ]) {
    assert.ok(source.includes(`<title>${stockTitle}</title>`), stockTitle);
    assert.ok(source.includes(compatibilityTitle), compatibilityTitle);
  }

  assert.match(editor, /href="favicon\.ico"/);
  assert.match(editor, /isCastleTekWLEDCompat\(\) \? "\/favicon\.svg" : "\/favicon\.ico"/);
  assert.match(notFound, /Akemi does not know where you are headed/);
  assert.match(notFound, /That CastleTek controller route does not exist/);
  assert.match(notFound, /nsEnd === path\.length \|\| path\.charAt\(nsEnd\) === "\/"/);
  assert.match(notFound, /nsIndex < 0 \? "\.\.\/\?sliders"/);
  assert.match(welcome, /Welcome to WLED!/);
  assert.match(welcome, /Welcome to CastleTek!/);
  assert.match(welcome, /controlsButton.*\.\/\?sliders/);

  assert.match(security, /castleTek \? "castletek_" : "wled_"/);
  assert.match(security, /<h3 id="aboutHeading">About<\/h3>/);
  assert.match(security, /gId\("aboutHeading"\)\.textContent = "About"/);
  assert.match(security, /gId\("productDescription"\)\.textContent = "CastleTek RGBW v1"/);

  assert.match(ui, /gId\('uiScopeDevice'\)\.textContent = 'The following UI customization settings are unique both to this CastleTek controller and this browser\.'/);
  assert.match(leds, /gId\('fpsWarnProductName'\)\.textContent = 'CastleTek controller'/);
  assert.match(sync, /function ctPrepareSync\(\) \{\s*if \(!isCastleTekWLEDCompat\(\)\) return;[\s\S]*'externalSyncWarning'[\s\S]*section\.hidden = true;/);
  assert.doesNotMatch(sync, /function getURL\(path\)/);

  assert.match(updater, /href="https:\/\/github\.com\/wled\/WLED\/releases\/latest"/);
  assert.match(updater, /name="skipValidation"/);
  assert.match(updater, /<title>CastleTek Software Update<\/title>/);
  assert.match(updater, /id="validationOverride" class="hide"/);
  assert.match(updater, /document\.title = "WLED Update"/);
  assert.match(updater, /gId\("validationOverride"\)\.classList\.remove\("hide"\)/);
  assert.match(updater, /id="compatibilityUpdateWarning">/);
  assert.match(updater, /!isCastleTekWLEDCompat\(\) && data\.repo/);
  assert.match(updater, /gId\("validationOverride"\)\.remove\(\)/);
  assert.ok(
    updater.indexOf('name="skipValidation"') < updater.indexOf("name='update'"),
    "stock validation override must be parsed before the firmware upload"
  );
  const compatibilityGuard = ota.indexOf("#ifndef CASTLETEK_WLED_COMPAT", ota.indexOf("static bool beginOTA"));
  const skipValidation = ota.indexOf('request->getParam("skipValidation", true)', compatibilityGuard);
  const guardEnd = ota.indexOf("#endif", skipValidation);
  assert.ok(compatibilityGuard >= 0 && compatibilityGuard < skipValidation && skipValidation < guardEnd);
  assert.match(ota, /Install the matching CastleTek compatibility image for this controller target\./);
});

test("optional usermods do not register unnamespaced AsyncWebServer routes", () => {
  for (const relativePath of [
    "usermods/multi_relay/multi_relay.cpp",
    "usermods/Artemis_reciever/usermod.cpp"
  ]) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /server\.on\((?:F\()?"\//, relativePath);
  }
});

// Usermod engine support remains installed; only configuration entry points close.
test("Compatibility hides Usermods and blocks route, metadata, form and restore bypasses", () => {
  const settings = read("wled00/data/settings.htm");
  assert.match(settings, /gId\('umbtn'\)\?\.remove\(\)/);
  const server = read("wled00/wled_server.cpp");
  assert.match(server, /isUsermods = lowercasePath == F\("\/settings\/um"\)/);
  assert.match(server, /lowercasePath == F\("\/u"\)/);
  assert.match(server, /return is2D \|\| \(isUI && !isCanonicalUIPost\) \|\| isUsermods/);
  assert.match(server, /if \(subPage == SUBPAGE_UI \|\| subPage == SUBPAGE_2D \|\| subPage == SUBPAGE_UM \|\| subPage == SUBPAGE_PINS\)/);
  assert.match(server, /subPage == SUBPAGE_2D \|\| \(subPage == SUBPAGE_UI && !isCanonicalUIPost\) \|\| subPage == SUBPAGE_UM/);
  assert.match(server, /#ifndef CASTLETEK_WLED_COMPAT\s+case SUBPAGE_UM/);
  assert.match(server, /#if defined\(WLED_ENABLE_USERMOD_PAGE\) && !defined\(CASTLETEK_WLED_COMPAT\)/);
  assert.match(server, /isConfig \|\| path == F\("\/bkp\.cfg\.json"\)/);
  assert.match(server, /\(isConfigRestore \|\| isSecurityRestore\) && !castleTekWLEDValidateUpload\(temporary, isSecurityRestore\)/);
  assert.match(server, /castleTekWLEDValidateRestore\(pDoc->as<JsonObject>\(\)\)/);
  const config = read("wled00/cfg.cpp");
  assert.match(config, /#ifdef CASTLETEK_WLED_COMPAT\s+\/\/ An unchanged config round trip[^\n]+\n  if \(fromFS && !usermods_settings.isNull\(\)\)/);
  assert.match(config, /UsermodManager::readFromConfig\(usermods_settings\)/);
  assert.match(config, /UsermodManager::addToConfig\(usermods_settings\)/);
  assert.match(config, /if \(fromFS\) \{\s+#endif\s+JsonArray hw_if_i2c/);
});
