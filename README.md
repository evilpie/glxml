# OpenGL Registry Reference

A static, searchable browser for Khronos `gl.xml`. The page parses the XML in the browser; there is no backend, build step, or generated data file.

## Update the registry

```bash
python3 tools/download-glxml.py
```

This downloads the current official registry snapshot to `data/gl.xml` and records its revision, immutable source URL, and SHA-256 digest in `data/source.json`.

## Run

Serve this directory with any static file server and open its root page. For example:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Browsers restrict loading the XML from `file://` pages.
