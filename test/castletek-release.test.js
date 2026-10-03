const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const release = require('../castletek/compatibility-v1/release.json');

function python(source) {
  const result = spawnSync('python3', ['-c', source], {cwd: root, encoding: 'utf8', timeout: 15000});
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}

test('standard DigQuad release loader isolates product identity from upstream and other targets', () => {
  const results = JSON.parse(python(`
import json, sys
sys.path.insert(0, 'pio-scripts')
from castletek_release import read_release
print(json.dumps([read_release(name) for name in ['castletek_compat_digquad_v2_v3_wifi', 'castletek_compat_esp32dev', 'esp32dev', 'castletek_digquad']]))
`));
  assert.deepEqual(results, [release, null, null, null]);
  assert.equal(release.version, '16.1.0+1.61');
  assert.equal(release.build, 2605011);
  assert.equal(require('../package.json').version, '16.0.0');
});

test('release manifest rejects wrong targets, malformed versions and noninteger build IDs', () => {
  python(`
import json, sys, tempfile
from pathlib import Path
sys.path.insert(0, 'pio-scripts')
from castletek_release import read_release, ENVIRONMENT
original = read_release(ENVIRONMENT)
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    file = root / 'castletek/compatibility-v1/release.json'
    file.parent.mkdir(parents=True)
    for override in [{'schema': True}, {'environment': 'esp32dev'}, {'target': 'CastleTek_WLED_Compat_ESP32'}, {'version': '16.1.0'}, {'version': '16.1.0+<html>'}, {'version': '16.1.0+01.61'}, {'version': '16.1.0+1.12345'}, {'version': '16.0001.0+1.61'}, {'version': '99999.1.0+1.61'}, {'build': True}, {'build': 0x100000000}, {'extra': 1}]:
        file.write_text(json.dumps(dict(original, **override)))
        try:
            read_release(ENVIRONMENT, root)
        except ValueError:
            continue
        raise AssertionError('Invalid release accepted')
`);
});

test('actual metadata build script applies product version and build only to standard DigQuad', () => {
  const rows = JSON.parse(python(`
import json, runpy
from pathlib import Path
class Environment(dict):
    def __init__(self, name):
        super().__init__(PIOENV=name, PROJECT_DIR=str(Path.cwd()), CPPDEFINES=[('WLED_REPO', 'unknown')])
    def Append(self, **kwargs):
        for key, values in kwargs.items(): self[key] += values
    def AddBuildMiddleware(self, callback, pattern):
        self.middleware = callback
    def Object(self, node, **kwargs):
        return kwargs['CPPDEFINES']
rows = []
for name in ['castletek_compat_digquad_v2_v3_wifi', 'castletek_compat_esp32dev', 'esp32dev', 'castletek_digquad']:
    env = Environment(name)
    runpy.run_path('pio-scripts/set_metadata.py', init_globals={'env': env, 'Import': lambda value: None})
    definitions = dict(env.middleware(env, 'wled_metadata.cpp'))
    rows.append({'name': name, 'version': definitions['WLED_VERSION'], 'build': definitions.get('CASTLETEK_FIRMWARE_BUILD'), 'sourceURL': definitions.get('CASTLETEK_FIRMWARE_SOURCE_URL')})
print(json.dumps(rows))
`));
  assert.equal(rows[0].version, release.version);
  assert.equal(rows[0].build, release.build);
  assert.ok(rows[0].sourceURL.includes('https://github.com/CastleTek/CT-Lights/releases/tag/v16.1.0-build1.61'));
  for (const row of rows.slice(1)) {
    assert.equal(row.version, '16.0.0');
    assert.equal(row.build, null);
    assert.equal(row.sourceURL, null);
  }
});

test('production VERSION preprocessor remains numeric and leaves generic and stock IDs unchanged', () => {
  const source = fs.readFileSync(path.join(root, 'wled00/wled.h'), 'utf8').split('//uncomment')[0]
    + '\nVERSION\n#endif\n';
  const cases = [
    {flags: ['-DCASTLETEK_WLED_COMPAT', `-DCASTLETEK_FIRMWARE_BUILD=${release.build}`], expected: String(release.build)},
    {flags: ['-DCASTLETEK_WLED_COMPAT'], expected: '2605010'},
    {flags: [], expected: '2605010'},
    {flags: [`-DCASTLETEK_FIRMWARE_BUILD=${release.build}`], expected: '2605010'}
  ];
  for (const {flags, expected} of cases) {
    const result = spawnSync(process.env.CXX || 'c++', ['-E', '-P', '-x', 'c++', ...flags, '-'], {input: source, encoding: 'utf8', timeout: 15000});
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(result.stdout.trim(), expected);
  }
});

test('CI packaging consumes the same manifest build number', () => {
  const result = spawnSync('python3', ['pio-scripts/castletek_release.py', release.environment, '--field', 'build'], {cwd: root, encoding: 'utf8', timeout: 15000});
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(result.stdout.trim(), String(release.build));
  const workflow = fs.readFileSync(path.join(root, fs.existsSync(path.join(root, '.github/workflows/wled-ci.yml')) ? '.github/workflows/wled-ci.yml' : '.github/workflows/digquad-release.yml'), 'utf8');
  assert.ok(workflow.includes('castletek_release.py') || workflow.includes('castletek-release-bundle.py build'));
  assert.doesNotMatch(workflow, /sed.*#define VERSION/);
});

// Upstream date-based builds may change only the numeric fallback, never the manifest branch.
test('shared CI date stamping preserves the CastleTek manifest version override', () => {
  const shared = path.join(root, '.github/workflows/build.yml');
  if (fs.existsSync(shared)) {
    const workflow = fs.readFileSync(shared, 'utf8');
    assert.ok(workflow.includes('s/^#define VERSION [0-9]+$/#define VERSION'));
    assert.ok(!workflow.includes('s/define VERSION .+'));
  } else {
    const workflow = fs.readFileSync(path.join(root, fs.existsSync(path.join(root, '.github/workflows/wled-ci.yml')) ? '.github/workflows/wled-ci.yml' : '.github/workflows/digquad-release.yml'), 'utf8');
    assert.match(workflow, /castletek-release-bundle.py build/);
    assert.doesNotMatch(workflow, /sed.*VERSION|platformio_release.ini|matrix:/);
  }
});
