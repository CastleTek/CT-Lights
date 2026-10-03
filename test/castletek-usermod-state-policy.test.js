const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');

for (const compatibility of [true, false]) {
	test(`AudioReactive persistent enabled setting ${compatibility ? 'stays installed in Compatibility' : 'remains editable in stock WLED'}`, () => {
		const source = fs.readFileSync(path.join(root, 'usermods/audioreactive/audio_reactive.cpp'), 'utf8');
		const start = source.indexOf('    void readFromJsonState(JsonObject& root) override');
		const end = source.indexOf('    void onStateChange(', start);
		assert.ok(start > 0 && end > start);
		const method = source.slice(start, end);
		const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-audio-policy-'));
		try {
			fs.writeFileSync(path.join(temp, 'audio.cpp'), `
#include <algorithm>
#include <cassert>
#include "src/dependencies/json/ArduinoJson-v6.h"
#define FPSTR(value) value
using std::min; using std::max;
struct Usermod { virtual void readFromJsonState(JsonObject&) = 0; };
struct AudioReactive : Usermod {
  bool initDone = true, enabled = true, addPalettes = true;
  unsigned removed = 0, created = 0, updates = 0;
  int inputLevel = 100;
  static constexpr const char* _name = "AudioReactive";
  static constexpr const char* _enabled = "enabled";
  static constexpr const char* _inputLvl = "inputLevel";
  void onUpdateBegin(bool) { updates++; }
  void removeAudioPalettes() { removed++; }
  void createAudioPalettes() { created++; }
${method}
};
int main() {
  AudioReactive audio;
  DynamicJsonDocument doc(1024);
  assert(!deserializeJson(doc, R"({"AudioReactive":{"enabled":false,"inputLevel":155}})"));
  JsonObject state = doc.as<JsonObject>();
  audio.readFromJsonState(state); // This is shared by direct state and preset application.
  assert(audio.inputLevel == 155);
#ifdef CASTLETEK_WLED_COMPAT
  assert(audio.enabled && audio.removed == 0 && audio.updates == 0);
#else
  assert(!audio.enabled && audio.removed == 1 && audio.updates == 1);
#endif
  audio.enabled = false;
  state["AudioReactive"]["enabled"] = true;
  state["AudioReactive"]["inputLevel"] = 999;
  audio.readFromJsonState(state);
  assert(audio.inputLevel == 255);
#ifdef CASTLETEK_WLED_COMPAT
  assert(!audio.enabled && audio.created == 0 && audio.updates == 0);
#else
  assert(audio.enabled && audio.created == 1 && audio.updates == 2);
#endif
  state["AudioReactive"]["inputLevel"] = -10;
  audio.readFromJsonState(state);
  assert(audio.inputLevel == 0);
  audio.initDone = false;
  state["AudioReactive"]["inputLevel"] = 42;
  audio.readFromJsonState(state);
  assert(audio.inputLevel == 0);
}
`);
			const binary = path.join(temp, 'audio');
			const flags = ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-DARDUINO_ARCH_ESP32'];
			if (compatibility) flags.push('-DCASTLETEK_WLED_COMPAT');
			const compiled = spawnSync(process.env.CXX || 'c++', [...flags, '-I', path.join(root, 'wled00'), path.join(temp, 'audio.cpp'), '-o', binary], {encoding: 'utf8', timeout: 60000});
			assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
			const result = spawnSync(binary, [], {encoding: 'utf8', timeout: 10000});
			assert.equal(result.status, 0, result.stderr || String(result.error));
		} finally {
			fs.rmSync(temp, {recursive: true, force: true});
		}
	});
}
