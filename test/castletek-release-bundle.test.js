const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const producer = path.join(root, 'tools/castletek-release-bundle.py');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const pythonEnvironment = {...process.env, PYTHONDONTWRITEBYTECODE: '1'};

function command(action, directory, output) {
  const args = [producer, action, '--root', directory];
  if (output) args.push('--output', output);
  return spawnSync('python3', args, {cwd: root, env: pythonEnvironment, encoding: 'utf8', timeout: 30000});
}

function successful(result) {
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

function rejected(result) {
  assert.notEqual(result.status, 0, 'Unsafe release input was accepted');
}

function exported(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'castletek-source-export-test-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const directory = path.join(temporary, 'snapshot');
  successful(command('export', root, directory));
  return {temporary, directory, manifest: JSON.parse(fs.readFileSync(path.join(directory, 'SOURCE-MANIFEST.json')))};
}

function python(source, args = []) {
  return spawnSync('python3', ['-c', `
import importlib.util, json, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('release_bundle', sys.argv[1])
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
${source}
`, producer, ...args], {cwd: root, env: pythonEnvironment, encoding: 'utf8', timeout: 30000});
}

function put(directory, relative, content = 'synthetic excluded test data\n') {
  const file = path.join(directory, relative);
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
  return file;
}

function files(directory, prefix = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? files(path.join(directory, entry.name), name + '/') : [name];
  }).sort();
}

test('real public export has a complete byte-verified source manifest and build/test inputs', t => {
  const {directory, manifest} = exported(t);
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.repository, 'CastleTek/CT-Lights');
  assert.equal(manifest.tag, 'v16.1.0-build1.61');
  assert.equal(manifest.sourceDateEpoch, 1790899200);
  const names = manifest.files.map(row => row.file);
  assert.deepEqual(names, [...new Set(names)].sort());
  assert.deepEqual(files(directory), [...names, 'SOURCE-MANIFEST.json'].sort());
  for (const row of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, row.file));
    assert.equal(bytes.length, row.size, row.file);
    assert.equal(sha256(bytes), row.sha256, row.file);
  }
  for (const required of [
    'LICENSE', 'CASTLETEK_MODIFICATIONS.md', 'platformio.ini', 'platformio_override.ini',
    'package-lock.json', 'requirements.txt', 'wled00/wled.h', 'wled00/castletek_update_key.h',
    'castletek/compatibility-v1/release.json', 'castletek/compatibility-v1/routes.json',
    'castletek/compatibility-v1/dependencies.json', 'pio-scripts/castletek_release.py',
    'tools/cdata.js', 'tools/cdata-test.js', 'tools/castletek-wled-mock.mjs',
    'tools/castletek-update-package.js', 'tools/castletek-release-bundle.py',
    'test/castletek-release-bundle.test.js', 'test/fixtures/castletek-layout-host.cpp',
    'usermods/audioreactive/audio_reactive.cpp', 'usermods/multi_relay/multi_relay.cpp',
    'usermods/Artemis_reciever/usermod.cpp', 'wled00/src/dependencies/fastled_slim/LICENSE.txt'
  ]) assert.ok(names.includes(required), 'Missing release input: ' + required);
  successful(command('verify', directory));
});

test('export excludes local configuration, generated files, private history and bench records', t => {
  const {directory, temporary} = exported(t);
  const excluded = [
    '.git/config', '.env', '.envrc', 'wled00/my_config.h', 'wled00/html_private.h',
    'wled00/js_private.h', 'wled00/private.cpp.bak', 'wled00/private.cpp~',
    'pio-scripts/__pycache__/private.pyc', 'node_modules/private/index.js',
    '.pio/build/private/firmware.bin', 'build_output/private-backup.json', 'logs/private.log',
    'docs/castletek/bench-synthetic-private.md', 'docs/castletek/release-synthetic-private.md',
    'docs/castletek/host-qualification-synthetic-private.md', 'platformio_release.ini'
  ];
  for (const name of excluded) put(directory, name);
  const output = path.join(temporary, 'reexported');
  successful(command('export', directory, output));
  for (const name of excluded) assert.ok(!fs.existsSync(path.join(output, name)), 'Private input exported: ' + name);
  assert.deepEqual(fs.readFileSync(path.join(output, 'CASTLETEK_MODIFICATIONS.md')),
    fs.readFileSync(path.join(root, 'castletek/compatibility-v1/PUBLIC_MODIFICATIONS.md')));
  assert.deepEqual(fs.readFileSync(path.join(output, 'README.md')),
    fs.readFileSync(path.join(root, 'docs/castletek/public-release.md')));
  rejected(command('export', directory, output));
});

test('public snapshot exposes one read-only DigQuad release workflow without upstream matrix publication', t => {
  const {directory} = exported(t);
  assert.deepEqual(files(path.join(directory, '.github/workflows')), ['digquad-release.yml']);
  const workflow = fs.readFileSync(path.join(directory, '.github/workflows/digquad-release.yml'), 'utf8');
  assert.equal(workflow, fs.readFileSync(path.join(root, 'castletek/compatibility-v1/public-ci.yml'), 'utf8'));
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /castletek-release-bundle\.py verify/);
  assert.match(workflow, /castletek-release-bundle\.py build/);
  assert.match(workflow, /--commit.*--ci-run/);
  assert.doesNotMatch(workflow, /contents: write|matrix:|platformio_release\.ini|sed.*VERSION|gh release|action-gh-release/);
});

test('source ZIP is deterministic, immutable and contains exactly the manifest bytes at relative paths', t => {
  const {directory, temporary, manifest} = exported(t);
  const first = path.join(temporary, 'source.zip');
  const second = path.join(temporary, 'repeat.zip');
  const result = python(`
import hashlib, os, zipfile
root, first, second = map(Path, sys.argv[2:5])
manifest = bundle.verify(root)
bundle.source_archive(root, first, manifest)
for row in manifest['files']:
    os.utime(root / row['file'], (1, 1))
bundle.source_archive(root, second, bundle.verify(root))
with zipfile.ZipFile(first) as archive:
    print(json.dumps([{'file': info.filename, 'size': info.file_size,
        'sha256': hashlib.sha256(archive.read(info)).hexdigest(),
        'mode': info.external_attr >> 16, 'date': info.date_time}
        for info in archive.infolist()]))
`, [directory, first, second]);
  successful(result);
  const archived = JSON.parse(result.stdout);
  assert.equal(sha256(fs.readFileSync(first)), sha256(fs.readFileSync(second)));
  const expected = [...manifest.files, {
    file: 'SOURCE-MANIFEST.json', size: fs.statSync(path.join(directory, 'SOURCE-MANIFEST.json')).size,
    sha256: sha256(fs.readFileSync(path.join(directory, 'SOURCE-MANIFEST.json')))
  }].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  assert.deepEqual(archived.map(({file, size, sha256}) => ({file, size, sha256})), expected);
  for (const entry of archived) {
    assert.equal(entry.mode, 0o100644);
    assert.deepEqual(entry.date, [2026, 10, 2, 0, 0, 0]);
    assert.ok(!path.isAbsolute(entry.file) && !entry.file.split('/').includes('..'));
  }
  const before = sha256(fs.readFileSync(first));
  rejected(python('bundle.source_archive(Path(sys.argv[2]), Path(sys.argv[3]), bundle.verify(Path(sys.argv[2])))', [directory, first]));
  assert.equal(sha256(fs.readFileSync(first)), before, 'Existing archive must never be overwritten');
});

test('verification rejects changed bytes and unlisted source files', t => {
  const {directory} = exported(t);
  const file = path.join(directory, 'wled00/const.h');
  const original = fs.readFileSync(file);
  fs.appendFileSync(file, '\n// synthetic changed input\n');
  rejected(command('verify', directory));
  fs.writeFileSync(file, original);
  successful(command('verify', directory));
  put(directory, 'wled00/unlisted-release-input.cpp');
  rejected(command('verify', directory));
});

test('archive creation rechecks source bytes and refuses unlisted input before writing output', t => {
  const {directory, temporary} = exported(t);
  const output = path.join(temporary, 'unapproved.zip');
  const source = path.join(directory, 'wled00/const.h');
  const original = fs.readFileSync(source);
  const result = python(`
root, output = map(Path, sys.argv[2:4])
manifest = bundle.verify(root)
(root / 'wled00/const.h').write_bytes((root / 'wled00/const.h').read_bytes() + b'\\n// changed after approval\\n')
bundle.source_archive(root, output, manifest)
`, [directory, output]);
  rejected(result);
  assert.ok(!fs.existsSync(output), 'Archive must not be created from changed approved bytes');
  fs.writeFileSync(source, original);
  rejected(python(`
root, output = map(Path, sys.argv[2:4])
manifest = bundle.verify(root)
(root / 'wled00/unlisted-release-input.cpp').write_text('// synthetic unapproved input\\n')
bundle.source_archive(root, output, manifest)
`, [directory, output]));
  assert.ok(!fs.existsSync(output), 'Archive must not be created with an unlisted source input');
});

test('manifest verification refuses traversal and duplicate records', t => {
  const {directory, manifest} = exported(t);
  const file = path.join(directory, 'SOURCE-MANIFEST.json');
  for (const altered of [
    {...manifest, files: [...manifest.files, {...manifest.files[0]}]},
    {...manifest, files: [{...manifest.files[0], file: '../outside.txt'}, ...manifest.files.slice(1)]},
    {...manifest, files: [{...manifest.files[0], file: '/outside.txt'}, ...manifest.files.slice(1)]}
  ]) {
    fs.writeFileSync(file, JSON.stringify(altered));
    rejected(command('verify', directory));
  }
});

test('export and verification reject linked source files without following them', t => {
  const {directory, temporary} = exported(t);
  const source = path.join(directory, 'wled00/const.h');
  const external = path.join(temporary, 'outside-source.h');
  fs.copyFileSync(source, external);
  fs.unlinkSync(source);
  fs.symlinkSync(external, source);
  rejected(command('verify', directory));
  rejected(command('export', directory, path.join(temporary, 'linked-export')));
});

test('verification refuses linked directories and dangling links in the approved source tree', t => {
  const {directory, temporary} = exported(t);
  const linkedDirectory = path.join(directory, 'wled00/unlisted-linked-directory');
  fs.symlinkSync(temporary, linkedDirectory, 'dir');
  rejected(command('verify', directory));
  rejected(command('export', directory, path.join(temporary, 'linked-directory-export')));
  fs.unlinkSync(linkedDirectory);
  fs.symlinkSync(path.join(temporary, 'missing-file'), path.join(directory, 'unlisted-dangling-link'));
  rejected(command('verify', directory));
});

test('export refuses selected directory roots and input parents that are symbolic links', t => {
  const {directory, temporary} = exported(t);
  for (const [index, relative] of ['wled00', 'tools', 'docs/castletek', 'usermods'].entries()) {
    const selected = path.join(directory, relative);
    const outside = path.join(temporary, 'outside-input-' + index);
    fs.renameSync(selected, outside);
    fs.symlinkSync(outside, selected, 'dir');
    try {
      rejected(command('export', directory, path.join(temporary, 'linked-root-export-' + index)));
    } finally {
      fs.unlinkSync(selected);
      fs.renameSync(outside, selected);
    }
  }
});
