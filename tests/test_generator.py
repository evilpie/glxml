import json
import tempfile
import unittest
from pathlib import Path

from glxml_site import build, gl_spec_url, parse_registry, spec_url


FIXTURE = '''<registry>
  <groups><group name="TextureParameterName"><enum name="GL_FOO"/></group></groups>
  <enums namespace="GL">
    <enum name="GL_FOO" value="0x84FE"/>
    <enum name="GL_FOO_EXT" value="0x84FE" alias="GL_FOO"/>
  </enums>
  <commands><command><proto>void <name>glSetFoo</name></proto>
    <param group="TextureParameterName"><ptype>GLenum</ptype> <name>pname</name></param>
    <param group="ReferencedOnly"><ptype>GLint</ptype> <name>value</name></param>
  </command></commands>
  <feature api="gl" name="GL_VERSION_4_6" number="4.6">
    <require><enum name="GL_FOO"/><command name="glSetFoo"/></require>
    <remove profile="core"><command name="glOld"/></remove>
  </feature>
  <extensions>
    <extension name="GL_ARB_foo" supported="gl|glcore"><require><enum name="GL_FOO"/></require></extension>
    <extension name="GL_EXT_foo" supported="gl|gles2"><require><enum name="GL_FOO_EXT"/></require></extension>
  </extensions>
</registry>'''


class GeneratorTests(unittest.TestCase):
    def test_registry_relationships(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'gl.xml'
            source.write_text(FIXTURE)
            data = parse_registry(source)
            enums = {item['name']: item for item in data['enums']}
            self.assertEqual(enums['GL_FOO']['value'], '0x84FE')
            self.assertEqual(enums['GL_FOO_EXT']['alias_of'], 'GL_FOO')
            group = next(item for item in data['groups'] if item['name'] == 'TextureParameterName')
            self.assertEqual(group['enums'], ['GL_FOO'])
            self.assertTrue(group['defined'])
            referenced = next(item for item in data['groups'] if item['name'] == 'ReferencedOnly')
            self.assertFalse(referenced['defined'])
            self.assertNotIn('enums', referenced)
            self.assertEqual(data['features'][0]['requires'][0]['enums'], ['GL_FOO'])
            self.assertEqual(data['extensions'][1]['requires'][0]['enums'], ['GL_FOO_EXT'])
            self.assertNotIn('features', enums['GL_FOO'])
            self.assertEqual(data['extensions'][0]['url'], 'https://registry.khronos.org/OpenGL/extensions/ARB/ARB_foo.txt')
            self.assertEqual(data['features'][0]['spec_url'], 'https://registry.khronos.org/OpenGL/specs/gl/glspec46.core.pdf')

    def test_build_writes_static_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'gl.xml'
            output = Path(tmp) / 'site'
            source.write_text(FIXTURE)
            output.mkdir()
            (output / 'data.js').write_text('old JavaScript data')
            build(source, output)
            for name in ('index.html', 'style.css', 'registry.js', 'app.js', 'data.json'):
                self.assertTrue((output / name).is_file())
            self.assertFalse((output / 'data.js').exists())
            result = json.loads((output / 'data.json').read_text())
            self.assertEqual(result['enums'][1]['name'], 'GL_FOO_EXT')
            self.assertEqual({group['name'] for group in result['groups']}, {'TextureParameterName', 'ReferencedOnly'})

    def test_spec_url_rejects_invalid_name(self):
        self.assertIsNone(spec_url('GL_ARB_foo/../../bad'))
        self.assertIsNone(gl_spec_url('9.9'))


if __name__ == '__main__':
    unittest.main()
