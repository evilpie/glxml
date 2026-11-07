import io
import json
import tempfile
import unittest
from pathlib import Path

from glxml_site import build
from update import COMMITS_URL, REPOSITORY, fetch_latest_xml, update
from test_generator import FIXTURE


REVISION = 'a' * 40
PERMALINK = f'https://github.com/{REPOSITORY}/blob/{REVISION}/xml/gl.xml'
RAW_URL = f'https://raw.githubusercontent.com/{REPOSITORY}/{REVISION}/xml/gl.xml'


class UpdaterTests(unittest.TestCase):
    def fake_opener(self, request, timeout):
        self.assertEqual(timeout, 30)
        self.requests.append(request.full_url)
        if request.full_url == COMMITS_URL:
            return io.BytesIO(json.dumps([{'sha': REVISION}]).encode())
        if request.full_url == RAW_URL:
            return io.BytesIO(FIXTURE.encode())
        raise AssertionError(f'unexpected URL: {request.full_url}')

    def test_fetch_pins_download_to_commit(self):
        self.requests = []
        xml, revision, url = fetch_latest_xml(self.fake_opener)
        self.assertEqual(self.requests, [COMMITS_URL, RAW_URL])
        self.assertEqual(xml, FIXTURE.encode())
        self.assertEqual(revision, REVISION)
        self.assertEqual(url, PERMALINK)

    def test_update_embeds_official_revision(self):
        self.requests = []
        with tempfile.TemporaryDirectory() as temporary:
            data = update(Path(temporary) / 'site', self.fake_opener)
            saved = json.loads((Path(temporary) / 'site' / 'data.json').read_text())
            self.assertEqual(data['source_url'], PERMALINK)
            self.assertEqual(saved['source_revision'], REVISION)
            self.assertEqual(saved['source_url'], PERMALINK)
            self.assertEqual(len(saved['source_sha256']), 64)

    def test_nonofficial_source_link_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / 'gl.xml'
            source.write_text(FIXTURE)
            with self.assertRaises(ValueError):
                build(source, Path(temporary) / 'site',
                      source_url=f'https://github.com/example/repo/blob/{REVISION}/xml/gl.xml',
                      source_revision=REVISION)


if __name__ == '__main__':
    unittest.main()
