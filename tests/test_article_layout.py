import functools
import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from preview import PreviewHandler, valid_article_layout


class ArticleLayoutTests(unittest.TestCase):
    def test_layout_rejects_unknown_drawings_and_invalid_positions(self):
        good = {"version": 1, "wide": {"rocket": {"x": .2, "y": .8}}, "narrow": {}}
        self.assertTrue(valid_article_layout(good))
        self.assertTrue(valid_article_layout({**good, "deleted": ["rocket"]}))
        for deleted in (["missing"], [None], "rocket"):
            self.assertFalse(valid_article_layout({**good, "deleted": deleted}))
        for position in ({"x": -1, "y": .8}, {"x": float('nan'), "y": .8}, {"x": True, "y": .8}):
            self.assertFalse(valid_article_layout({**good, "wide": {"rocket": position}}))
        self.assertFalse(valid_article_layout({**good, "wide": {"../../other": {"x": .2, "y": .8}}}))

    def test_save_persists_and_rejects_other_origins(self):
        with tempfile.TemporaryDirectory() as folder:
            server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(PreviewHandler, directory=folder))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                host = f'127.0.0.1:{server.server_port}'
                data = {"version": 1, "wide": {"rocket": {"x": .3, "y": .6}}, "narrow": {}, "deleted": ["smile"]}
                def post(origin, value):
                    connection = http.client.HTTPConnection(host)
                    connection.request('POST', '/__practicehaven/001/layout', json.dumps(value),
                                       {'Origin': origin, 'Content-Type': 'application/json'})
                    response = connection.getresponse()
                    response.read()
                    connection.close()
                    return response.status
                self.assertEqual(post('https://other.example', data), 403)
                self.assertEqual(post('http://' + host, data), 204)
                saved = Path(folder) / 'practicehaven/001/layout.json'
                self.assertEqual(json.loads(saved.read_text()), data)
                self.assertEqual(post('http://' + host, {**data, 'wide': {'rocket': {'x': 2, 'y': 0}}}), 400)
                self.assertEqual(json.loads(saved.read_text()), data)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    unittest.main()
