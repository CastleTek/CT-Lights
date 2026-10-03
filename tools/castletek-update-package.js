#!/usr/bin/env node
// CastleTek Compatibility v1 release packaging. This is an integrity package,
// not a digital signature or an authentication mechanism.
const fs = require('node:fs');
const crypto = require('node:crypto');

const targets = new Set(['CastleTek_WLED_Compat_ESP32', 'CastleTek_WLED_Compat_DigQuad_v2v3']);
const maxImageSize = 0x180000;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest();

function cString(bytes, offset, length) {
  const field = bytes.subarray(offset, offset + length);
  const end = field.indexOf(0);
  if (end <= 0 || [...field.subarray(0, end)].some(value => value < 32 || value > 126)) {
    throw new Error('Invalid embedded firmware metadata string.');
  }
  return field.subarray(0, end).toString('ascii');
}

function inspectFirmware(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 768 || bytes.length > maxImageSize) {
    throw new Error('Firmware does not fit the Compatibility v1 application slot.');
  }
  if (bytes[0] !== 0xe9 || bytes[1] < 1 || bytes[1] > 16 || bytes.readUInt16LE(12) !== 0 || bytes[23] !== 1) {
    throw new Error('Expected a raw ESP32 application image with its SHA-256 digest.');
  }
  let offset = 24, checksum = 0xef, firstEnd = 0;
  for (let segment = 0; segment < bytes[1]; segment++) {
    if (offset + 8 > bytes.length) throw new Error('Truncated firmware segment header.');
    const count = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (count > bytes.length - offset) throw new Error('Truncated firmware segment.');
    if (segment === 0) firstEnd = offset + count;
    for (const value of bytes.subarray(offset, offset + count)) checksum ^= value;
    offset += count;
  }
  const checksumOffset = Math.floor((offset + 16) / 16) * 16 - 1;
  if (checksumOffset + 33 !== bytes.length || bytes[checksumOffset] !== checksum) {
    throw new Error('Firmware length or ESP checksum is invalid.');
  }
  if (!sha256(bytes.subarray(0, checksumOffset + 1)).equals(bytes.subarray(checksumOffset + 1))) {
    throw new Error('Firmware embedded SHA-256 does not match its contents.');
  }
  if (bytes.readUInt32LE(32) !== 0xabcd5432 || firstEnd < 288 + 119) {
    throw new Error('Expected an application image, not a bootloader or merged flash image.');
  }
  // WLED places its custom description after the 256-byte ESP app description.
  const metadata = 288;
  const schema = bytes.readUInt32LE(metadata + 4);
  if (bytes.readUInt32LE(metadata) !== 0x57535453 || ![1, 2].includes(schema)) {
    throw new Error('Missing or unsupported CastleTek firmware metadata.');
  }
  const version = cString(bytes, metadata + 8, 48);
  const target = cString(bytes, metadata + 56, 48);
  let hash = 5381;
  for (const value of Buffer.from(target, 'ascii')) hash = (Math.imul(hash, 33) + value) >>> 0;
  if (!targets.has(target) || bytes.readUInt32LE(metadata + 104) !== hash) {
    throw new Error('Unsupported or inconsistent CastleTek hardware target.');
  }
  if (bytes.readUInt32LE(metadata + 111) !== 0x43545550 || bytes.readUInt32LE(metadata + 115) !== 1) {
    throw new Error('Firmware must retain CastleTek update policy 1. Older unguarded images are not supported.');
  }
  return {target, version, size: bytes.length, sha256: sha256(bytes).toString('hex')};
}

function makePackage(bytes, build) {
  if (!Number.isSafeInteger(build) || build < 0 || build > 0xffffffff) {
    throw new Error('Build must be an unsigned 32-bit integer.');
  }
  return {schema: 1, product: 'CastleTek WLED Compatibility v1', ...inspectFirmware(bytes),
    build, firmware: bytes.toString('base64')};
}

if (require.main === module) {
  try {
    const [input, output, buildFlag, buildText, ...extra] = process.argv.slice(2);
    if (!input || !output || buildFlag !== '--build' || !/^\d+$/.test(buildText || '') || extra.length || !output.endsWith('.ctfw')) {
      throw new Error('Usage: node tools/castletek-update-package.js firmware.bin release.ctfw --build BUILD_NUMBER');
    }
    const info = fs.statSync(input);
    if (!info.isFile() || info.size > maxImageSize) throw new Error('Input must be a firmware file within the application-slot limit.');
    const packed = makePackage(fs.readFileSync(input), Number(buildText));
    fs.writeFileSync(output, JSON.stringify(packed) + '\n', {flag: 'wx'});
    process.stdout.write(`Created ${output}: ${packed.target}, version ${packed.version}, ${packed.size} firmware bytes.\n`);
  } catch (error) {
    process.stderr.write(`Package not created: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {inspectFirmware, makePackage};
