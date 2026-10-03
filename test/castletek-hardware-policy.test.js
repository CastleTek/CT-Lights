const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

// Compile the actual policy with its vendored JSON decoder. Only network and
// hardware adapters are stubbed; Bus classification comes from production too.
for (const profile of ["16,17,18,19", "16,3,1,4"]) {
  test(`hardware policy executes against the ${profile} board profile`, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "castletek-policy-host-"));
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
      const stub = fs.readFileSync(path.join(root, "test/fixtures/castletek-hardware-policy-host.h"), "utf8");
      const checks = fs.readFileSync(path.join(root, "test/fixtures/castletek-hardware-policy-host.cpp"), "utf8");
      const config = fs.readFileSync(path.join(root, "wled00/cfg.cpp"), "utf8");
      const begin = config.indexOf('  JsonObject hw = doc[F("hw")];');
      const end = config.indexOf('  uint16_t total = hw_led', begin);
      assert.ok(begin >= 0 && end > begin, "missing production output migration block");
      const loader = `static bool loadLEDConfig(JsonObject doc) {
  const bool fromFS = true;
  bool needsSave = false;
${config.slice(begin, end)}  return needsSave;
}
`;
      const source = stub.replace("// PRODUCTION_BUS_METHODS", methods) + "\n" + wifi + "\n" + policy.replace(include, "") + "\n" + loader + checks;
      fs.writeFileSync(path.join(temp, "policy.cpp"), source);
      const binary = path.join(temp, "policy");
      const compiled = spawnSync(process.env.CXX || "c++", ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-DCASTLETEK_WLED_COMPAT", `-DDATA_PINS=${profile}`, ...(profile === "16,3,1,4" ? ["-DCASTLETEK_WLED_FIXED_RELAY_PIN=15"] : []), "-I", path.join(root, "wled00"), path.join(temp, "policy.cpp"), "-o", binary], { encoding: "utf8", timeout: 60000 });
      assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
      const ran = spawnSync(binary, [], { encoding: "utf8", timeout: 10000 });
      assert.equal(ran.status, 0, ran.stderr || String(ran.error));
      assert.match(ran.stdout, /policy checks passed: \d+/);
      process.stdout.write(ran.stdout);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
}
