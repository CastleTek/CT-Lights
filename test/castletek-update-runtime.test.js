const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('production CastleTek OTA runtime enforces admission, exact streaming, one writer and failure cleanup', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-update-runtime-'));
  try {
    // Supply host platform fakes and a generated test-only key verifier. Never
    // include or inspect the production app-key verifier in the test fixture.
    const runtime = read('wled00/castletek_update.cpp').replace(
      /^#include [<"](?:wled\.h|castletek_update\.h|esp_ota_ops\.h|mbedtls\/sha256\.h|ota_update\.h|castletek_update_key\.h)[>"]\n/gm,
      ''
    );
    const source = read('test/fixtures/castletek-update-runtime-host.h') + '\n' + runtime + '\n' +
      read('test/fixtures/castletek-update-runtime-host.cpp');
    const sourcePath = path.join(temp, 'runtime.cpp');
    const binary = path.join(temp, 'runtime');
    fs.writeFileSync(sourcePath, source);
    const flags = ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
      '-I', path.join(root, 'wled00'), sourcePath, '-o', binary];
    if (process.platform !== 'darwin') flags.push('-lcrypto');
    const compiled = spawnSync(process.env.CXX || 'c++', flags, {encoding: 'utf8', timeout: 60000});
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], {encoding: 'utf8', timeout: 15000});
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /OTA runtime checks passed: \d+/);
    process.stdout.write(ran.stdout);
  } finally {
    fs.rmSync(temp, {recursive: true, force: true});
  }
});
