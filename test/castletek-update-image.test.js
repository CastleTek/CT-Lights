const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
test('actual CastleTek OTA image parser validates raw ESP32 images across transport boundaries', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-update-image-'));
  try {
    const binary = path.join(temp, 'image-policy');
    const compiled = spawnSync(process.env.CXX || 'c++', [
      '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I', path.join(root, 'wled00'),
      path.join(root, 'test/fixtures/castletek-update-image-host.cpp'), '-o', binary,
    ], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
    const ran = spawnSync(binary, [], { encoding: 'utf8', timeout: 15000 });
    assert.equal(ran.status, 0, ran.stderr || String(ran.error));
    assert.match(ran.stdout, /OTA image checks passed: \d+/);
    process.stdout.write(ran.stdout);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
