const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("Compatibility uploads and migration backups preserve the active configuration", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "castletek-upload-host-"));
  try {
    const bus = fs.readFileSync(path.join(root, "wled00/bus_manager.h"), "utf8");
    const methods = ["getNumberOfPins", "is2Pin", "isPWM", "isVirtual", "isHub75", "numPWMPins"]
      .map(name => {
        const line = bus.split("\n").find(line => line.includes("static constexpr") && line.split("{")[0].includes(`${name}(`));
        assert.ok(line, `missing production Bus::${name}`);
        return line;
      }).join("\n");
    const wifi = fs.readFileSync(path.join(root, "wled00/castletek_wled_wifi.cpp"), "utf8").replace('#include "wled.h"', "");
    const policy = fs.readFileSync(path.join(root, "wled00/castletek_wled_hardware.cpp"), "utf8");
    const include = '#include "wled.h"';
    assert.equal(policy.split(include).length, 2, "policy must have one host-adapter include");
    const server = fs.readFileSync(path.join(root, "wled00/wled_server.cpp"), "utf8");
    const start = server.indexOf("static String castleTekWLEDUploadPath");
    const end = server.indexOf("#else\nstatic void handleUpload", start);
    assert.ok(start >= 0 && end > start, "missing production Compatibility upload implementation");
    const compatibility = fs.readFileSync(path.join(root, "wled00/castletek_wled_compat.h"), "utf8");
    const safePath = compatibility.match(/inline bool castleTekWLEDIsSafeLegacyPath\([^]*?\n}/);
    assert.ok(safePath, "missing production upload path validation");
    const cfg = fs.readFileSync(path.join(root, "wled00/cfg.cpp"), "utf8");
    const migrationStart = cfg.indexOf('if (success && !WLED_FS.exists(F("/cfg.prepolicy.json")))');
    const migrationEnd = cfg.indexOf("\n  #endif", migrationStart);
    assert.ok(migrationStart >= 0 && migrationEnd > migrationStart, "missing production prepolicy backup block");
    const serializer = cfg.match(/void serializeConfigToFS\(\) \{[^]*?\n}/);
    assert.ok(serializer, "missing production configuration file serializer");
    const file = fs.readFileSync(path.join(root, "wled00/file.cpp"), "utf8");
    const copyFile = file.match(/bool copyFile\([^]*?\n}/);
    assert.ok(copyFile, "missing production file copy implementation");
    const stub = fs.readFileSync(path.join(root, "test/fixtures/castletek-hardware-upload-host.h"), "utf8");
    const checks = fs.readFileSync(path.join(root, "test/fixtures/castletek-hardware-upload-host.cpp"), "utf8");
    const source = stub.replace("// PRODUCTION_BUS_METHODS", methods) + "\n" +
      safePath[0] + "\n" + wifi + "\n" + policy.replace(include, "") + "\n" + server.slice(start, end) + "\n" +
      copyFile[0] + "\nstatic void hostRetainPrepolicy(bool success) {\n  DynamicJsonDocument boot(8192); deserializeJson(boot, WLED_FS.bytes(\"/cfg.json\")); JsonObject root = boot.as<JsonObject>();\n" + cfg.slice(migrationStart, migrationEnd) +
      "\n}\n" + serializer[0] + "\n" + checks;
    fs.writeFileSync(path.join(temp, "upload.cpp"), source);
    const binary = path.join(temp, "upload");
    const compiled = spawnSync(process.env.CXX || "c++", ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-DCASTLETEK_WLED_COMPAT", "-DDATA_PINS=16,3,1,4", "-I", path.join(root, "wled00"), path.join(temp, "upload.cpp"), "-o", binary], { encoding: "utf8", timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], { encoding: "utf8", timeout: 10000 });
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /upload checks passed: \d+/);
    process.stdout.write(ran.stdout);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
