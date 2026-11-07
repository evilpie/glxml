#!/usr/bin/env python3
"""Fetch the latest Khronos gl.xml revision from GitHub and rebuild the site."""

from __future__ import annotations

import argparse
import json
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

from glxml_site import build

REPOSITORY = "KhronosGroup/OpenGL-Registry"
COMMITS_URL = f"https://api.github.com/repos/{REPOSITORY}/commits?path=xml%2Fgl.xml&per_page=1"
MAX_XML_BYTES = 20_000_000


def read_url(url: str, opener=urllib.request.urlopen, *, limit: int) -> bytes:
    request = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json" if url.startswith("https://api.github.com/") else "application/xml",
        "User-Agent": "glxml-site-generator",
    })
    with opener(request, timeout=30) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError(f"GitHub response is larger than {limit} bytes")
    return content


def fetch_latest_xml(opener=urllib.request.urlopen) -> tuple[bytes, str, str]:
    commits = json.loads(read_url(COMMITS_URL, opener, limit=1_000_000))
    if not isinstance(commits, list) or not commits or not isinstance(commits[0], dict):
        raise ValueError("GitHub returned no commits for xml/gl.xml")
    revision = commits[0].get("sha")
    if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", revision):
        raise ValueError("GitHub returned an invalid commit SHA")
    raw_url = f"https://raw.githubusercontent.com/{REPOSITORY}/{revision}/xml/gl.xml"
    xml = read_url(raw_url, opener, limit=MAX_XML_BYTES)
    if ET.fromstring(xml).tag != "registry":
        raise ValueError("The downloaded XML is not a gl.xml registry")
    source_url = f"https://github.com/{REPOSITORY}/blob/{revision}/xml/gl.xml"
    return xml, revision, source_url


def update(output: Path, opener=urllib.request.urlopen) -> dict:
    xml, revision, source_url = fetch_latest_xml(opener)
    with tempfile.TemporaryDirectory(prefix="glxml-update-") as temporary:
        source = Path(temporary) / "gl.xml"
        source.write_bytes(xml)
        data = build(source, output, source_url=source_url, source_revision=revision)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=Path(__file__).resolve().parent / "site",
                        help="output directory (default: site beside this script)")
    args = parser.parse_args()
    try:
        data = update(args.output)
    except (urllib.error.URLError, OSError, ValueError, ET.ParseError, json.JSONDecodeError) as error:
        parser.exit(1, f"Update failed: {error}\n")
    print(f"Built {args.output} from KhronosGroup/OpenGL-Registry@{data['source_revision']}")


if __name__ == "__main__":
    main()
