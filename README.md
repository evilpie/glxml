# GL Registry Explorer

A dependency-free Python generator for a static, searchable OpenGL registry site. It reads Khronos `gl.xml` and writes HTML, CSS, JavaScript, and actual JSON data. Serve the output from a static host or local HTTP server.

The checked-in [site](site/index.html) was generated from the official Khronos GitHub repository. Its exact XML commit is linked in the site and recorded in `site/data.json`. Run the updater again to refresh it.

## Build

1. Fetch the latest official [`gl.xml`](https://github.com/KhronosGroup/OpenGL-Registry/blob/main/xml/gl.xml) and build the site:

   ```bash
   python3 update.py
   ```

   The updater finds the latest GitHub commit that changed `xml/gl.xml`, downloads that exact revision, and records its immutable GitHub link and SHA-256 digest in `site/data.json`.

2. Serve the directory and open `http://localhost:8000`:

   ```bash
   python3 -m http.server --directory site 8000
   ```

The generated `data.json` contains the registry records. The browser fetches that file; no server API is needed. Opening `index.html` through `file://` may block the JSON request, so use a local HTTP server. Extension specification links lead to the [Khronos OpenGL Registry](https://registry.khronos.org/OpenGL/index_gl.php).

`data.json` uses schema version 2. Feature and extension requirements are stored once in their respective records; group membership is stored in group records and command parameters. The browser derives reverse links, including constant-to-extension relationships, when it loads the file.

You can still build from a local file with `python3 glxml_site.py /path/to/gl.xml site`. If its exact Khronos commit is known, pass both `--source-revision` and the matching `--source-url` permalink. Otherwise the site labels the GitHub revision as unknown.

## What the site shows

- Every unique constant name, its registry value, explicit aliases, parameter groups, core and other API feature requirements, removals, and extension memberships.
- Every command's signature, parameter groups, aliases, feature requirements, and extension memberships.
- Parameter groups as searchable records, with their constants and the command parameters that reference them.
- Extension records with supported APIs, introduced constants and commands, and a direct specification link.
- OpenGL, OpenGL ES, and OpenGL SC feature records, including required and removed names.
- Direct Khronos specification links for OpenGL core versions and extension records.
- Search by name or value. Links such as `#enum/GL_TEXTURE_MAX_ANISOTROPY` open a specific record.

The constant detail view includes extension memberships inherited through explicit aliases. For example, `GL_TEXTURE_MAX_ANISOTROPY` links to both its ARB extension and the EXT extension associated with `GL_TEXTURE_MAX_ANISOTROPY_EXT`.

`gl.xml` does not encode every function that accepts a constant. The site lists commands connected by the registry's parameter groups, and separately lists commands introduced by associated extensions. A missing group association means the XML has no such link; it does not mean the constant is unusable with a command. Core version information is derived from `<feature><require>` entries, with profile-specific requirements shown in the detail view. The generator does not parse specification prose.

The contents of a generated site reflect the exact `gl.xml` used to build it. Regenerate after updating the source file.

## Test

```bash
python3 -m unittest discover -s tests -v
node tests/test_registry.js
```
