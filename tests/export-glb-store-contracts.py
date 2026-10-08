import io
import json
import struct
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def glb(payload=b"{}  "):
    body = struct.pack("<I4s", len(payload), b"JSON") + payload
    return b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body


def post(query, data):
    handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
    handler.client_address = ("127.0.0.1", 50000)
    handler.headers = {"Content-Length": str(len(data))}
    handler.rfile = io.BytesIO(data)
    replies = []
    handler.send_json = lambda value, *args: replies.append((value, args[0] if args else 200))
    handler.handle_export_glb(serve.parse_qs(query))
    return replies[0]


with TemporaryDirectory() as directory:
    exports = Path(directory) / "exports"
    serve.BROWSE_ROOTS["exports"] = exports
    first = glb(b'{"a":1}')
    reply, status = post("name=Chair%20and%20cube", first)
    assert status == 200 and reply["saved"] == "Chair-and-cube.glb" and reply["root"] == "exports", (reply, status)
    assert (exports / "Chair-and-cube.glb").read_bytes() == first
    reply, status = post("name=Chair-and-cube.glb", glb(b'{"b":2}'))
    assert status == 409 and reply["exists"] == "Chair-and-cube.glb" and (exports / "Chair-and-cube.glb").read_bytes() == first
    reply, status = post("name=Chair-and-cube&overwrite=1", glb(b'{"b":2}'))
    assert status == 200 and (exports / "Chair-and-cube.glb").read_bytes() == glb(b'{"b":2}')
    assert post("name=bad", b"not a glb at all")[1] == 400
    assert post("name=///", first)[1] == 400
    reply, status = post("name=../../escape", first)
    assert status == 200 and reply["saved"] == "escape.glb" and (exports / "escape.glb").exists()
    # A file appearing between the existence check and the write is refused, not replaced.
    original_link = serve.os.link
    def racing_link(src, dst):
        Path(dst).write_bytes(b"other export")
        return original_link(src, dst)
    serve.os.link = racing_link
    try:
        reply, status = post("name=race", first)
    finally:
        serve.os.link = original_link
    assert status == 409 and (exports / "race.glb").read_bytes() == b"other export", (reply, status)
    assert not list(exports.glob(".race.glb.*")), "no staging file is left behind"
print("export glb store contracts passed")
