const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {inspectFirmware, makePackage} = require('../tools/castletek-update-package.js');

function image(target = 'CastleTek_WLED_Compat_DigQuad_v2v3', policy = 1, version = '16.0.0') {
  const payload = Buffer.alloc(1024);
  payload.writeUInt32LE(0xabcd5432, 0);
  const metadata = 256;
  payload.writeUInt32LE(0x57535453, metadata);
  payload.writeUInt32LE(1, metadata + 4);
  payload.write(version, metadata + 8, 'ascii');
  payload.write(target, metadata + 56, 'ascii');
  let hash = 5381;
  for (const value of Buffer.from(target)) hash = (Math.imul(hash, 33) + value) >>> 0;
  payload.writeUInt32LE(hash, metadata + 104);
  payload.writeUInt32LE(0x43545550, metadata + 111);
  payload.writeUInt32LE(policy, metadata + 115);
  const prefix = Buffer.alloc(1072);
  prefix[0] = 0xe9; prefix[1] = 1; prefix[23] = 1;
  prefix.writeUInt32LE(0x3f400020, 24);
  prefix.writeUInt32LE(payload.length, 28);
  payload.copy(prefix, 32);
  prefix[1071] = [...payload].reduce((checksum, value) => checksum ^ value, 0xef);
  return Buffer.concat([prefix, crypto.createHash('sha256').update(prefix).digest()]);
}

test('release packaging derives target and version from both actual image profiles', () => {
  for (const target of ['CastleTek_WLED_Compat_ESP32', 'CastleTek_WLED_Compat_DigQuad_v2v3']) {
    const firmware = image(target);
    const packaged = makePackage(firmware, 2605010);
    assert.equal(packaged.schema, 1);
    assert.equal(packaged.product, 'CastleTek WLED Compatibility v1');
    assert.equal(packaged.target, target);
    assert.equal(packaged.version, '16.0.0');
    assert.equal(packaged.size, firmware.length);
    assert.equal(packaged.sha256, crypto.createHash('sha256').update(firmware).digest('hex'));
    assert.deepEqual(Buffer.from(packaged.firmware, 'base64'), firmware);
  }
});

test('DigQuad semantic build metadata survives packaging without changing schema or numeric build', () => {
  const release = require('../castletek/compatibility-v1/release.json');
  const packaged = makePackage(image(release.target, 1, release.version), release.build);
  assert.equal(packaged.version, '16.1.0+1.61');
  assert.equal(packaged.build, 2605011);
  assert.deepEqual(Object.keys(packaged).sort(), ['schema', 'product', 'target', 'version', 'build', 'size', 'sha256', 'firmware'].sort());
});

test('release packaging rejects corruption, truncation and appended bytes', () => {
  const firmware = image();
  const corrupt = Buffer.from(firmware); corrupt[50] ^= 1;
  for (const invalid of [corrupt, firmware.subarray(0, -1), Buffer.concat([firmware, Buffer.from([0])])]) {
    assert.throws(() => inspectFirmware(invalid), /checksum|SHA-256|length/i);
  }
});

test('release packaging rejects older unguarded and unknown policy images', () => {
  assert.throws(() => makePackage(image(undefined, 0), 1), /policy 1/);
  assert.throws(() => makePackage(image(undefined, 2), 1), /policy 1/);
});

test('release packaging rejects Pro, stock and unknown hardware images', () => {
  for (const target of ['ESP32', 'CastleTek_Pro', 'CastleTek_WLED_Compat_Unknown']) {
    assert.throws(() => inspectFirmware(image(target)), /hardware target/);
  }
});

test('release packaging rejects non-image, oversize, other-chip and malformed length inputs', () => {
  const otherChip = image(); otherChip.writeUInt16LE(9, 12);
  const segmentOverflow = image(); segmentOverflow.writeUInt32LE(0xffffffff, 28);
  const noHash = image(); noHash[23] = 0;
  for (const invalid of [Buffer.from('{}'), Buffer.alloc(0x180001), otherChip, segmentOverflow, noHash]) {
    assert.throws(() => inspectFirmware(invalid));
  }
  for (const build of [true, -1, 1.5, '1', 0x100000000]) assert.throws(() => makePackage(image(), build));
});

module.exports = {image};
