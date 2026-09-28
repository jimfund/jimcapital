import json
import math
import os
import re
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SAVE_LOCK = threading.Lock()
DOODLE_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")


def valid_drawing(data):
    def number(value, low, high):
        return type(value) in (int, float) and math.isfinite(value) and low <= value <= high

    def color(value):
        return isinstance(value, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", value)

    if not isinstance(data, dict) or data.get("version") != 1:
        return False
    position = data.get("number")
    strokes = data.get("strokes")
    if not isinstance(position, dict) or not isinstance(strokes, list) or len(strokes) > 2000:
        return False
    if not all(number(position.get(axis), 0, 1) for axis in ("x", "y")):
        return False
    if not number(position.get("size"), 14, 120) or not color(position.get("color")):
        return False
    if "enabled" in position and not isinstance(position["enabled"], bool):
        return False
    total = 0
    for stroke in strokes:
        if not isinstance(stroke, dict) or stroke.get("tool") not in ("pen", "eraser"):
            return False
        if not color(stroke.get("color")) or not number(stroke.get("width"), 1, 80):
            return False
        points = stroke.get("points")
        if not isinstance(points, list) or len(points) > 20000:
            return False
        total += len(points)
        if total > 100000:
            return False
        for point in points:
            if not isinstance(point, list) or len(point) != 2 or not all(number(v, 0, 1) for v in point):
                return False
    return True


def valid_layout(data):
    if not isinstance(data, dict) or data.get("version") != 1:
        return False
    items = data.get("items")
    if not isinstance(items, dict) or len(items) > 103:
        return False
    for key, item in items.items():
        if key not in ("prediction", "angel", "monitor") and not DOODLE_ID.fullmatch(key):
            return False
        if not isinstance(item, dict):
            return False
        for field, low, high in (("x", 0, 1200), ("y", 0, 6000), ("width", 32, 1000), ("z", 0, 10000)):
            value = item.get(field)
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                return False
        if item["x"] + item["width"] > 1200.001:
            return False
    return True


def atomic_json(destination, data):
    serialized = json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n"
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=destination.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(serialized)
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


class PreviewHandler(SimpleHTTPRequestHandler):
    def do_POST(self):
        drawing_id = self.path.removeprefix("/__doodles/") if self.path.startswith("/__doodles/") else None
        if self.path not in ("/__doodle", "/__layout") and (not drawing_id or not DOODLE_ID.fullmatch(drawing_id)):
            self.send_error(404)
            return
        port = self.server.server_port
        hosts = {f"localhost:{port}", f"127.0.0.1:{port}"}
        origins = {f"http://{host}" for host in hosts}
        if self.headers.get("Host") not in hosts or self.headers.get("Origin") not in origins:
            self.send_error(403)
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 2_000_000:
                self.send_error(413)
                return
            data = json.loads(self.rfile.read(length))
            if not (valid_layout(data) if self.path == "/__layout" else valid_drawing(data)):
                self.send_error(400)
                return
        except (ValueError, TypeError, OverflowError):
            self.send_error(400)
            return
        assets = Path(self.directory) / "assets"
        try:
            with SAVE_LOCK:
                if drawing_id:
                    manifest_path = assets / "doodles.json"
                    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"version": 1, "ids": []}
                    if drawing_id not in manifest["ids"] and len(manifest["ids"]) >= 100:
                        self.send_error(409)
                        return
                    atomic_json(assets / "doodles" / f"{drawing_id}.json", data)
                    if drawing_id not in manifest["ids"]:
                        manifest["ids"].append(drawing_id)
                        atomic_json(manifest_path, manifest)
                else:
                    name = "layout.json" if self.path == "/__layout" else "monitor-doodle.json"
                    atomic_json(assets / name, data)
        except (OSError, ValueError, KeyError, TypeError):
            self.send_error(500)
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8000), partial(PreviewHandler, directory=str(ROOT)))
    server.serve_forever()
