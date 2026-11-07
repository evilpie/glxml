#!/usr/bin/env python3
"""Download the latest Khronos OpenGL registry XML to data/gl.xml."""
import hashlib
import json
import urllib.request
from pathlib import Path

REPOSITORY = "KhronosGroup/OpenGL-Registry"
API = f"https://api.github.com/repos/{REPOSITORY}/commits?path=xml%2Fgl.xml&per_page=1"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
OUT = DATA_DIR / "gl.xml"
SOURCE = DATA_DIR / "source.json"

with urllib.request.urlopen(API) as response:
    revision = json.load(response)[0]["sha"]
url = f"https://raw.githubusercontent.com/{REPOSITORY}/{revision}/xml/gl.xml"
request = urllib.request.Request(url, headers={"User-Agent": "glxml-site-downloader"})
with urllib.request.urlopen(request) as response:
    xml = response.read()
if not xml.lstrip().startswith(b"<?xml") or b"<registry" not in xml[:2000]:
    raise SystemExit("Downloaded file is not a Khronos gl.xml registry")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_bytes(xml)
source_url = f"https://github.com/{REPOSITORY}/blob/{revision}/xml/gl.xml"
SOURCE.write_text(json.dumps({"repository": f"https://github.com/{REPOSITORY}", "revision": revision, "source_url": source_url, "sha256": hashlib.sha256(xml).hexdigest()}, indent=2) + "\n", encoding="utf-8")
print(f"Saved {len(xml):,} bytes to {OUT} (revision {revision})")
