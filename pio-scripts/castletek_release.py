"""Standard Dig-Quad release identity shared by compilation, filenames and CI."""
import argparse
import json
from pathlib import Path
import re

ENVIRONMENT = "castletek_compat_digquad_v2_v3_wifi"
TARGET = "CastleTek_WLED_Compat_DigQuad_v2v3"
COMPONENT = r"(?:0|[1-9][0-9]{0,3})"
VERSION_PATTERN = rf"{COMPONENT}\.{COMPONENT}\.{COMPONENT}\+{COMPONENT}(?:\.{COMPONENT}){{1,2}}"


def read_release(environment, project_dir=None):
    if environment != ENVIRONMENT:
        return None
    root = Path(project_dir) if project_dir else Path(__file__).resolve().parents[1]
    release = json.loads((root / "castletek/compatibility-v1/release.json").read_text())
    if (set(release) != {"schema", "environment", "target", "version", "build"}
            or type(release["schema"]) is not int or release["schema"] != 1
            or release["environment"] != ENVIRONMENT or release["target"] != TARGET
            or not isinstance(release["version"], str)
            or len(release["version"]) >= 48
            or not re.fullmatch(VERSION_PATTERN, release["version"])
            or type(release["build"]) is not int or not 0 < release["build"] <= 0xffffffff):
        raise ValueError("Invalid standard Dig-Quad release identity")
    return release


def release_tag(release):
    return "v" + release["version"].replace("+", "-build")


def source_url(release):
    return "https://github.com/CastleTek/CT-Lights/releases/tag/" + release_tag(release)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment")
    parser.add_argument("--field", choices=["version", "build", "target", "tag", "sourceURL"], required=True)
    args = parser.parse_args()
    release = read_release(args.environment)
    if release is None:
        parser.error("Only the standard Dig-Quad environment has a CastleTek release identity")
    print(release_tag(release) if args.field == "tag" else source_url(release) if args.field == "sourceURL" else release[args.field])
