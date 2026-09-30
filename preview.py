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
    if "aspect" in data and not number(data["aspect"], .05, 20):
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
        if not color(stroke.get("color")) or not number(stroke.get("width"), .01, 1600):
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
    if not isinstance(items, dict) or len(items) > 106:
        return False
    for key, item in items.items():
        if key not in ("prediction", "angel", "monitor", "softbank", "clock", "one-word") and not DOODLE_ID.fullmatch(key):
            return False
        if not isinstance(item, dict):
            return False
        for field, low, high in (("x", 0, 1200), ("y", 0, 6000), ("width", 32, 1200), ("z", 0, 10000)):
            value = item.get(field)
            if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
                return False
        if item["x"] + item["width"] > 1200.001:
            return False
    return True


def valid_scene(data):
    if not isinstance(data, dict) or data.get("version") != 1 or not valid_layout(data.get("layout")):
        return False
    drawings = data.get("drawings")
    if not isinstance(drawings, dict) or "monitor" not in drawings or len(drawings) > 101:
        return False
    for key, drawing in drawings.items():
        if key != "monitor" and not DOODLE_ID.fullmatch(key):
            return False
        if key not in data["layout"]["items"] or not valid_drawing(drawing):
            return False
    expected = {"prediction", "angel"} | set(drawings)
    # Older open editors can still save scenes without newer widgets.
    if "softbank" in data["layout"]["items"]:
        expected.add("softbank")
    if "clock" in data["layout"]["items"]:
        expected.add("clock")
    if "one-word" in data["layout"]["items"]:
        expected.add("one-word")
    return set(data["layout"]["items"]) == expected


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


def valid_article_layout(data):
    if not isinstance(data, dict) or not {"version", "wide", "narrow"} <= set(data) or set(data) - {"version", "wide", "narrow", "deleted"} or data["version"] != 1:
        return False
    ids = {p.stem for p in (ROOT / "prac/001/doodles").glob("*.svg")}
    deleted = data.get("deleted", [])
    if not isinstance(deleted, list) or len(deleted) > len(ids) or not all(isinstance(key, str) and key in ids for key in deleted):
        return False
    for mode in ("wide", "narrow"):
        positions = data[mode]
        if not isinstance(positions, dict) or not set(positions) <= ids:
            return False
        for position in positions.values():
            if not isinstance(position, dict) or set(position) != {"x", "y"}:
                return False
            if not all(type(v) in (int, float) and math.isfinite(v) and 0 <= v <= 1 for v in position.values()):
                return False
    return True


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # The editor and preview must use the same current scripts and artwork.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/practicehaven" or self.path.startswith("/practicehaven/"):
            self.send_response(308)
            self.send_header("Location", self.path.replace("/practicehaven", "/prac", 1))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        drawing_id = self.path.removeprefix("/__doodles/") if self.path.startswith("/__doodles/") else None
        article_layout = self.path in ("/__prac/001/layout", "/__practicehaven/001/layout")
        if not article_layout and self.path not in ("/__doodle", "/__layout", "/__scene") and (not drawing_id or not DOODLE_ID.fullmatch(drawing_id)):
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
            limit = 16_000_000 if self.path == "/__scene" else 2_000_000
            if not 0 < length <= limit:
                self.send_error(413)
                return
            data = json.loads(self.rfile.read(length))
            validator = valid_article_layout if article_layout else valid_scene if self.path == "/__scene" else valid_layout if self.path == "/__layout" else valid_drawing
            if not validator(data):
                self.send_error(400)
                return
        except (ValueError, TypeError, OverflowError):
            self.send_error(400)
            return
        assets = Path(self.directory) / "assets"
        try:
            with SAVE_LOCK:
                if article_layout:
                    atomic_json(Path(self.directory) / "prac/001/layout.json", data)
                elif self.path == "/__scene":
                    for key, drawing in data["drawings"].items():
                        path = assets / "monitor-doodle.json" if key == "monitor" else assets / "doodles" / f"{key}.json"
                        atomic_json(path, drawing)
                    atomic_json(assets / "doodles.json", {"version": 1, "ids": [key for key in data["drawings"] if key != "monitor"]})
                    atomic_json(assets / "layout.json", data["layout"])
                elif drawing_id:
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
