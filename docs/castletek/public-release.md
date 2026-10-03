# CT-Lights firmware

CastleTek RGBW v1 firmware for the standard DigQuad Wi-Fi controller, based on
WLED 16.0.0. Release `16.1.0+1.61` / build `2605011` is published under tag
[`v16.1.0-build1.61`](https://github.com/CastleTek/CT-Lights/releases/tag/v16.1.0-build1.61).

The release page provides the app-import `.ctfw`, the raw application `.bin`,
the corresponding-source ZIP, dependency record, checksums and release manifest.
The firmware About page links to that exact release. The repository contains
an approved source snapshot without private development history. Copyright,
EUPL v1.2-or-later terms and attribution are retained in `LICENSE`,
`CASTLETEK_MODIFICATIONS.md` and dependency sources.

## Build the corresponding source

Use Node 22.23.1, Python 3.11, PlatformIO Core 6.2.0 and a C++17 host compiler.
Public CI runs host tests on Ubuntu 24.04 and the DigQuad build on Ubuntu 22.04.
Install Git so PlatformIO can fetch the pinned upstream dependencies.

```sh
python -m pip install platformio==6.2.0
python tools/castletek-release-bundle.py verify
npm ci
SOURCE_DATE_EPOCH=1790899200 npm run build -- --force
npm test -- --test-concurrency=1
python tools/castletek-release-bundle.py build --output build_output/local-release
```

The bundle command creates the source ZIP first, extracts and verifies it, then
builds only `castletek_compat_digquad_v2_v3_wifi` from that extraction. It never
uploads to a controller. The source manifest verifies each included file. Browser
headers are regenerated; they are not source inputs. Local builds have null CI
provenance; distributable release manifests name the exact public Git commit and
successful GitHub run. Builds at different paths/platforms are not guaranteed
byte-identical. Compare the published manifest, not an assumed rebuild hash.

DigQuad dependency versions/commits are pinned in `platformio_override.ini` and
recorded in `castletek/compatibility-v1/dependencies.json`. Node dependencies use
`package-lock.json`; the audio usermod pins arduinoFFT 2.0.1. The release dependency
asset additionally records resolved library versions, commits and content hashes.
All downloaded dependencies retain their own licenses. No private credentials,
controller configuration or backups are needed to rebuild this firmware.

## Installation and integrity

Import the matching `.ctfw` through CastleTek Lights. Do not flash a merged image
or another board target. The internal OTA target remains
`CastleTek_WLED_Compat_DigQuad_v2v3`; friendly labels do not alter compatibility.
`release-manifest.json` connects the source archive, raw binary, app package and
dependency record by SHA-256. `firmware.imageSHA256` is the ESP image digest used
to match a running controller; `firmware.sha256` hashes the entire binary.
Keep the source archive and notices with redistributed firmware.

Compatibility update policy 1 uses a reusable embedded app key on a trusted LAN.
That value is recoverable from the source and firmware; it is not a protected
secret, device pairing or a publisher signature. This source publication does
not change that security model. Use trusted/isolated networks.

## Release process

Run `export --output <new-directory>` against the approved development snapshot.
The tool excludes private history, local configuration, generated headers, caches,
bench records and build outputs. Review `SOURCE-MANIFEST.json`, then publish only
that new snapshot. The public workflow has read-only repository permissions;
it runs host tests and one DigQuad build, and uploads a candidate artifact.

A release operator publishes the successful CI artifact unchanged. Verify all
public release assets anonymously, including the complete source ZIP and hashes,
before enabling that firmware in the app update catalog. Retain release assets
permanently; the expiring CI artifact alone is not the source-download service.
