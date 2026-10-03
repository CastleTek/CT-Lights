#!/usr/bin/env python3
"""Export audited firmware sources; build DigQuad from that archive; bind release assets."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'pio-scripts'))
from castletek_release import ENVIRONMENT, read_release, release_tag, source_url
REPOSITORY = 'CastleTek/CT-Lights'
# Fixed source date is part of this release's reviewed build inputs, not wall-clock output.
SOURCE_DATE_EPOCH = 1790899200
DIRECTORIES = ('wled00', 'lib', 'include', 'boards', 'pio-scripts', 'usermods/audioreactive', 'usermods/multi_relay', 'usermods/Artemis_reciever', 'test', 'castletek/compatibility-v1')
FILES = ('LICENSE', 'CASTLETEK_MODIFICATIONS.md', '.gitignore', 'package.json', 'package-lock.json',
         'platformio.ini', 'platformio_override.ini', 'requirements.in', 'requirements.txt',
         'tools/cdata.js', 'tools/cdata-test.js', 'tools/castletek-wled-mock.mjs', 'tools/castletek-update-package.js',
         'tools/castletek-release-bundle.py', 'docs/castletek/public-release.md')
EXCLUDED_PARTS = {'.git', '.pio', 'node_modules', '__pycache__', '.cache', 'build_output', 'logs'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def approved(path):
    """Only release build inputs; reject local overrides, generated output and backups."""
    if any(part in EXCLUDED_PARTS or part.startswith('._') for part in path.parts):
        return False
    if path.name in {'.DS_Store', 'my_config.h', 'platformio_release.ini'}:
        return False
    if path.suffix in {'.pyc', '.bak', '.log'} or path.name.endswith('~'):
        return False
    if path.parent.as_posix() == 'wled00' and (path.name.startswith('html_') or path.name.startswith('js_')):
        return False
    return True


def reject_linked_path(root, relative):
    for part in [relative, *relative.parents]:
        if (root / part).is_symlink():
            raise ValueError('Linked release input: ' + str(relative))


def inputs(root):
    candidates = {Path(name) for name in FILES}
    candidates.update(path.relative_to(root) for name in DIRECTORIES for path in (root / name).rglob('*') if path.is_file())
    candidates.update(path.relative_to(root) for path in (root / 'tools').glob('*.csv'))
    return sorted(path for path in candidates if approved(path))


def export(root, output):
    """Create a new history-free source tree, transforming only public README and CI entrypoint."""
    if output.exists():
        raise ValueError('Export destination already exists; refusing to merge source snapshots')
    for name in (*DIRECTORIES, *FILES):
        reject_linked_path(root, Path(name))
    for name in DIRECTORIES:
        for item in (root / name).rglob('*'):
            if item.is_symlink() and approved(item.relative_to(root)):
                raise ValueError('Linked release input: ' + str(item.relative_to(root)))
    output.mkdir(parents=True)
    for relative in inputs(root):
        source = root / relative
        if source.is_symlink() or not source.is_file():
            raise ValueError('Missing or linked release input: ' + str(relative))
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o644)
    mappings = {'CASTLETEK_MODIFICATIONS.md': 'castletek/compatibility-v1/PUBLIC_MODIFICATIONS.md', 'README.md': 'docs/castletek/public-release.md', '.github/workflows/digquad-release.yml': 'castletek/compatibility-v1/public-ci.yml'}
    for target, source in mappings.items():
        destination = output / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / source, destination)
    (output / '.nvmrc').write_text('22.23.1\n')
    release = read_release(ENVIRONMENT, output)
    rows = [{'file': p.relative_to(output).as_posix(), 'size': p.stat().st_size, 'sha256': digest(p.read_bytes())}
            for p in sorted(output.rglob('*')) if p.is_file()]
    write_json(output / 'SOURCE-MANIFEST.json', {'schema': 1, 'repository': REPOSITORY,
        'tag': release_tag(release), 'sourceDateEpoch': SOURCE_DATE_EPOCH, 'files': rows})
    verify(output)
    return len(rows)


def verify(root):
    """Verify approved source bytes; never accept paths that escape the snapshot."""
    manifest = json.loads((root / 'SOURCE-MANIFEST.json').read_text())
    release = read_release(ENVIRONMENT, root)
    if manifest.get('schema') != 1 or manifest.get('repository') != REPOSITORY or manifest.get('tag') != release_tag(release):
        raise ValueError('Source manifest does not identify this release')
    if manifest.get('sourceDateEpoch') != SOURCE_DATE_EPOCH:
        raise ValueError('Unexpected release build timestamp')
    seen = set()
    for row in manifest['files']:
        relative = Path(row['file'])
        if relative.is_absolute() or '..' in relative.parts or not approved(relative) or row['file'] in seen:
            raise ValueError('Unsafe or repeated source manifest path')
        seen.add(row['file'])
        reject_linked_path(root, relative)
        file = root / relative
        if file.is_symlink() or not file.is_file() or file.stat().st_size != row['size'] or digest(file.read_bytes()) != row['sha256']:
            raise ValueError('Source changed after export: ' + row['file'])
    for item in root.rglob('*'):
        if item.is_symlink() and approved(item.relative_to(root)):
            raise ValueError('Linked source snapshot entry')
    actual = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and approved(p.relative_to(root))}
    # Git and generated build outputs are deliberately absent from approval. Other files fail closed.
    if actual - {'SOURCE-MANIFEST.json'} != seen:
        raise ValueError('Unlisted file in public source snapshot')
    return manifest


def source_archive(root, output, manifest):
    if verify(root) != manifest:
        raise ValueError('Source manifest changed before archiving')
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted([row['file'] for row in manifest['files']] + ['SOURCE-MANIFEST.json']):
            entry = zipfile.ZipInfo(name, (2026, 10, 2, 0, 0, 0))
            entry.external_attr = (0o100644 << 16)
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, (root / name).read_bytes())


def run(args, root, environment=None, capture=False):
    result = subprocess.run(args, cwd=root, env=environment, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def file_record(file):
    return {'file': file.name, 'size': file.stat().st_size, 'sha256': digest(file.read_bytes())}


def content_hash(directory):
    rows = [(p.relative_to(directory).as_posix(), digest(p.read_bytes())) for p in sorted(directory.rglob('*'))
            if p.is_file() and not p.is_symlink() and not any(part in {'.git', '__pycache__'} for part in p.relative_to(directory).parts)]
    return digest(json.dumps(rows, separators=(',', ':')).encode())


def platform_packages():
    core = Path(os.environ.get('PLATFORMIO_CORE_DIR', Path.home() / '.platformio'))
    expected = {'framework-arduinoespressif32': '2.0.18+sha.8ba0dc0',
                'toolchain-xtensa-esp32': '8.4.0+2021r2-patch5'}
    selected = []
    for name, version in expected.items():
        matches = []
        for directory in (core / 'packages').glob(name + '*'):
            file = directory / 'package.json'
            if file.is_file():
                meta = json.loads(file.read_text())
                if meta.get('name') == name and meta.get('version') == version:
                    matches.append(directory)
        if len(matches) != 1:
            raise ValueError('Expected exactly one pinned platform package: ' + name)
        selected.append(matches[0])
    platforms = [p.parent for p in (core / 'platforms').glob('*/platform.json')
                 if json.loads(p.read_text()).get('version') == '2024.06.00']
    if len(platforms) != 1:
        raise ValueError('Pinned Espressif platform is missing or ambiguous')
    return platforms + selected


def third_party_notices(root, output):
    sections = ['Third-party notices for the compiled CT-Lights DigQuad dependencies.\n'
                'Additional embedded notices are retained in corresponding-source files.\n']
    directories = [p for p in (root / '.pio/libdeps' / ENVIRONMENT).iterdir() if p.is_dir()]
    directories += platform_packages()
    count = 0
    for directory in sorted(directories):
        for file in sorted(directory.rglob('*')):
            relative = file.relative_to(directory)
            if file.is_file() and not file.is_symlink() and '.git' not in relative.parts and re.match(r'^(license|licence|copying|notice)(?:[._-].*)?$', file.name, re.I):
                if file.stat().st_size > 1024 * 1024:
                    raise ValueError('Unexpectedly large dependency notice')
                sections.append('\n===== ' + directory.name + '/' + relative.as_posix() + ' =====\n' + file.read_text(errors='replace'))
                count += 1
    if count == 0:
        raise ValueError('No third-party notices found')
    output.write_text('\n'.join(sections))


def dependency_record(root, pio):
    """Record actual resolved library versions/commits without host paths or credential-bearing config."""
    records = []
    for directory in sorted((root / '.pio/libdeps' / ENVIRONMENT).iterdir()):
        if not directory.is_dir():
            continue
        record = {'name': directory.name}
        meta = directory / '.piopm'
        if meta.exists():
            value = json.loads(meta.read_text())
            record.update({key: value[key] for key in ('name', 'version') if key in value})
        if (directory / '.git').exists():
            record['commit'] = run(['git', 'rev-parse', 'HEAD'], directory, capture=True)
        rows = [(p.relative_to(directory).as_posix(), digest(p.read_bytes())) for p in sorted(directory.rglob('*'))
                if p.is_file() and '.git' not in p.relative_to(directory).parts]
        record['contentSHA256'] = digest(json.dumps(rows, separators=(',', ':')).encode())
        records.append(record)
    packages = []
    for directory in platform_packages():
        file = directory / ('platform.json' if (directory / 'platform.json').exists() else 'package.json')
        metadata = json.loads(file.read_text())
        packages.append({'name': metadata['name'], 'version': metadata['version'], 'manifestSHA256': digest(file.read_bytes()), 'contentSHA256': content_hash(directory)})
    return {'schema': 1, 'environment': ENVIRONMENT, 'platformPackages': packages, 'node': run(['node', '--version'], root, capture=True),
        'python': platform.python_version(), 'platformio': run([pio, '--version'], root, capture=True),
        'host': platform.system(), 'declared': json.loads((root / 'castletek/compatibility-v1/dependencies.json').read_text()),
        'libraries': records}


def build(root, output, pio, commit=None, ci_run=None):
    manifest = verify(root)
    release = read_release(ENVIRONMENT, root)
    tag = release_tag(release)
    if commit is not None and not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Expected exact public source commit')
    if ci_run is not None and not re.fullmatch(r'[1-9][0-9]*', ci_run):
        raise ValueError('Expected GitHub CI run ID')
    if output.exists():
        raise ValueError('Release output already exists; never overwrite a published candidate')
    output.mkdir(parents=True)
    prefix = 'CT-Lights-' + tag
    source = output / (prefix + '-source.zip')
    source_archive(root, source, manifest)
    # The shipped archive is the build input. No private checkout files enter this directory.
    extracted = output / 'source-build'
    extracted.mkdir()
    with zipfile.ZipFile(source) as archive:
        archive.extractall(extracted)
    verify(extracted)
    env = dict(os.environ, SOURCE_DATE_EPOCH=str(manifest['sourceDateEpoch']))
    run(['npm', 'ci'], extracted, env)
    run(['npm', 'run', 'build', '--', '--force'], extracted, env)
    run([pio, 'run', '-e', ENVIRONMENT], extracted, env)
    verify(extracted)
    firmware = output / (prefix + '-DigQuad.bin')
    shutil.copyfile(extracted / '.pio/build' / ENVIRONMENT / 'firmware.bin', firmware)
    package = output / (prefix + '-DigQuad.ctfw')
    run(['node', 'tools/castletek-update-package.js', str(firmware.resolve()), str(package.resolve()), '--build', str(release['build'])], extracted)
    info = json.loads(run(['node', '-e', 'const fs=require("fs");console.log(JSON.stringify(require("./tools/castletek-update-package").inspectFirmware(fs.readFileSync(process.argv[1]))));', str(firmware.resolve())], extracted, capture=True))
    if info['target'] != release['target'] or info['version'] != release['version']:
        raise ValueError('Compiled firmware identity does not match release source')
    dependency = output / (prefix + '-dependencies.json')
    write_json(dependency, dependency_record(extracted, pio))
    published = {'schema': 1, 'repository': REPOSITORY, 'tag': tag, 'sourceCommit': commit, 'ciRunID': int(ci_run) if ci_run is not None else None,
        **{key: release[key] for key in ('environment', 'target', 'version', 'build')},
        'source': file_record(source), 'firmware': {**file_record(firmware), 'imageSHA256': firmware.read_bytes()[-32:].hex()},
        'package': file_record(package), 'dependencyLock': file_record(dependency)}
    write_json(output / 'release-manifest.json', published)
    third_party_notices(extracted, output / 'THIRD_PARTY_NOTICES.txt')
    shutil.copyfile(root / 'LICENSE', output / 'LICENSE')
    shutil.copyfile(root / 'CASTLETEK_MODIFICATIONS.md', output / 'CASTLETEK_MODIFICATIONS.md')
    with (output / 'SHA256SUMS.txt').open('w') as sums:
        for file in sorted(output.iterdir()):
            if file.is_file() and file.name != 'SHA256SUMS.txt':
                sums.write(digest(file.read_bytes()) + '  ' + file.name + '\n')
    print(json.dumps({'tag': tag, 'sourceURL': source_url(release), 'size': info['size'], 'sha256': info['sha256']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['export', 'verify', 'build'])
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--pio', default='pio')
    parser.add_argument('--commit')
    parser.add_argument('--ci-run')
    args = parser.parse_args()
    try:
        root = args.root.resolve()
        if args.action == 'verify':
            print('Verified', len(verify(root)['files']), 'source files')
        elif args.output is None:
            parser.error('--output is required')
        elif args.action == 'export':
            print('Exported', export(root, args.output.resolve()), 'approved source files')
        else:
            build(root, args.output.resolve(), args.pio, args.commit, args.ci_run)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')
