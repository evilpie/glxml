#!/usr/bin/env python3
"""Build a static browser for Khronos gl.xml."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

ASSETS = Path(__file__).resolve().parent / "site_assets"
EXTENSION_BASE = "https://registry.khronos.org/OpenGL/extensions"
REGISTRY_INDEX = "https://registry.khronos.org/OpenGL/index_gl.php"
GL_SPEC_BASE = "https://registry.khronos.org/OpenGL/specs/gl"


def text_of(element: ET.Element) -> str:
    return "".join(element.itertext()).strip()


def unique(items):
    return list(dict.fromkeys(items))


def compact(record: dict) -> dict:
    """Omit absent optional fields from each JSON record."""
    return {key: value for key, value in record.items() if value is not None and value != []}


def spec_url(extension_name: str) -> str | None:
    parts = extension_name.split("_", 2)
    if len(parts) != 3 or parts[0] != "GL" or not re.fullmatch(r"[A-Za-z0-9_]+", extension_name):
        return None
    return f"{EXTENSION_BASE}/{parts[1]}/{parts[1]}_{parts[2]}.txt"


def gl_spec_url(version: str | None) -> str | None:
    files = {
        "1.0": "glspec10.pdf", "1.1": "glspec11.pdf", "1.2": "glspec121.pdf",
        "1.3": "glspec13.pdf", "1.4": "glspec14.pdf", "1.5": "glspec15.pdf",
        "2.0": "glspec20.pdf", "2.1": "glspec21.pdf", "3.0": "glspec30.pdf",
        "3.1": "glspec31.pdf",
    }
    if version and version not in files and re.fullmatch(r"(?:3\.[23]|4\.[0-6])", version):
        files[version] = "glspec" + version.replace(".", "") + ".core.pdf"
    return f"{GL_SPEC_BASE}/{files[version]}" if version in files else None


def validate_source_link(url: str | None, revision: str | None) -> None:
    if url is None and revision is None:
        return
    if not url or not revision or not re.fullmatch(r"[0-9a-fA-F]{40}", revision):
        raise ValueError("source URL and full 40-character revision must be supplied together")
    pattern = rf"https://github\.com/KhronosGroup/OpenGL-Registry/blob/{revision}/xml/gl\.xml"
    if not re.fullmatch(pattern, url, flags=re.IGNORECASE):
        raise ValueError("source URL must be the official Khronos gl.xml permalink at the supplied revision")


def parse_registry(path: Path, *, source_url: str | None = None, source_revision: str | None = None) -> dict:
    root = ET.parse(path).getroot()
    enums: dict[str, dict] = {}
    commands: dict[str, dict] = {}
    extensions: dict[str, dict] = {}
    features: dict[str, dict] = {}
    group_enums: dict[str, set[str]] = defaultdict(set)
    group_comments: dict[str, str] = {}
    defined_groups: set[str] = set()
    referenced_groups: set[str] = set()

    for group in root.findall("groups/group"):
        name = group.get("name")
        if name:
            defined_groups.add(name)
            group_enums[name].update(e.get("name") for e in group.findall("enum") if e.get("name"))
            if group.get("comment"):
                group_comments[name] = group.get("comment")

    for bucket in root.findall("enums"):
        for element in bucket.findall("enum"):
            name = element.get("name")
            if not name:
                continue
            record = enums.setdefault(name, {
                "name": name, "value": None, "alias_of": None,
                "apis": [], "comment": None, "type": None,
            })
            for key in ("value", "comment", "type"):
                if element.get(key) and not record[key]:
                    record[key] = element.get(key)
            if element.get("alias"):
                record["alias_of"] = element.get("alias")
            if element.get("group"):
                for group in element.get("group").split(","):
                    group = group.strip()
                    if group:
                        group_enums[group].add(name)
            if element.get("api"):
                record["apis"].append(element.get("api"))
    for element in root.findall("commands/command"):
        name = element.findtext("proto/name") or element.get("name")
        if not name:
            continue
        params = []
        declarations = []
        for param in element.findall("param"):
            pname = param.findtext("name") or ""
            groups = [g.strip() for g in (param.get("group") or "").split(",") if g.strip()]
            params.append(compact({"name": pname, "groups": groups}))
            declarations.append(" ".join(text_of(param).split()))
            referenced_groups.update(groups)
        aliases = [a.get("name") for a in element.findall("alias") if a.get("name")]
        commands[name] = {
            "name": name, "signature": " ".join(text_of(element.find("proto")).split()) +
            "(" + ", ".join(declarations) + ")" if element.find("proto") is not None else name,
            "params": params, "aliases": aliases,
        }

    for element in root.findall("feature"):
        name = element.get("name")
        if not name:
            continue
        feature = {
            "name": name, "version": element.get("number"), "api": element.get("api"),
            "spec_url": gl_spec_url(element.get("number")) if element.get("api") == "gl" else None,
            "requires": [], "removes": [],
        }
        for block in element:
            if block.tag not in ("require", "remove"):
                continue
            entry = compact({
                "api": block.get("api"), "profile": block.get("profile"),
                "enums": unique(item.get("name") for item in block.findall("enum") if item.get("name")),
                "commands": unique(item.get("name") for item in block.findall("command") if item.get("name")),
            })
            if "enums" in entry or "commands" in entry:
                feature["requires" if block.tag == "require" else "removes"].append(entry)
        features[name] = compact(feature)

    for element in root.findall("extensions/extension"):
        name = element.get("name")
        if not name:
            continue
        extension = {
            "name": name, "supported": (element.get("supported") or "").split("|"),
            "url": spec_url(name), "requires": [],
        }
        for block in element.findall("require"):
            entry = compact({
                "api": block.get("api"), "profile": block.get("profile"),
                "enums": unique(item.get("name") for item in block.findall("enum") if item.get("name")),
                "commands": unique(item.get("name") for item in block.findall("command") if item.get("name")),
            })
            if "enums" in entry or "commands" in entry:
                extension["requires"].append(entry)
        extensions[name] = compact(extension)

    for record in enums.values():
        record["apis"] = unique(record["apis"])

    groups = [{
        "name": name,
        "defined": name in defined_groups,
        "comment": group_comments.get(name),
        "enums": sorted(group_enums[name]),
    } for name in sorted(group_enums.keys() | referenced_groups)]

    return {
        "schema_version": 2,
        "source": path.name,
        "source_url": source_url,
        "source_revision": source_revision,
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "registry_url": REGISTRY_INDEX,
        "enums": [compact(item) for item in enums.values()],
        "commands": [compact(item) for item in commands.values()],
        "extensions": list(extensions.values()), "features": list(features.values()),
        "groups": [compact(item) for item in groups],
    }


def build(source: Path, output: Path, *, source_url: str | None = None,
          source_revision: str | None = None) -> dict:
    validate_source_link(source_url, source_revision)
    data = parse_registry(source, source_url=source_url, source_revision=source_revision)
    output.mkdir(parents=True, exist_ok=True)
    for asset in ("index.html", "style.css", "registry.js", "app.js"):
        shutil.copyfile(ASSETS / asset, output / asset)
    payload = json.dumps(data, ensure_ascii=True, separators=(",", ":"))
    (output / "data.json").write_text(payload + "\n", encoding="utf-8")
    # Remove data from builds made before the JSON format change.
    (output / "data.js").unlink(missing_ok=True)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("xml", type=Path, help="path to Khronos gl.xml")
    parser.add_argument("output", type=Path, help="output directory")
    parser.add_argument("--source-url", help="immutable GitHub URL for this XML snapshot")
    parser.add_argument("--source-revision", help="GitHub commit SHA for this XML snapshot")
    args = parser.parse_args()
    if not args.xml.is_file():
        parser.error(f"XML file not found: {args.xml}")
    try:
        validate_source_link(args.source_url, args.source_revision)
    except ValueError as error:
        parser.error(str(error))
    data = build(args.xml, args.output, source_url=args.source_url,
                 source_revision=args.source_revision)
    print(f"Built {args.output}: {len(data['enums'])} constants, {len(data['commands'])} commands, "
          f"{len(data['extensions'])} extensions, {len(data['features'])} features, "
          f"{len(data['groups'])} parameter groups")


if __name__ == "__main__":
    main()
