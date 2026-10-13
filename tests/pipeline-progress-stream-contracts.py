# kaminos-test: python
"""The streaming pipeline route forwards adapter progress events and ends with the run result."""
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import serve  # noqa: E402

PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000200fe4a3a0b0000000049454e44ae426082")

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    source_root = root / "stream-source"
    source_root.mkdir()
    (source_root / "source.png").write_bytes(PNG)
    out_dir = root / "stream-run"
    previous_browse = dict(serve.BROWSE_ROOTS)
    previous_command = os.environ.get("KAMINOS_SHARP_COMMAND")
    serve.BROWSE_ROOTS["stream-test"] = str(source_root)
    os.environ["KAMINOS_SHARP_COMMAND"] = str(ROOT / "tests" / "fixtures" / "mock-sharp-command.mjs")
    handler = SimpleNamespace(wfile=io.BytesIO())
    try:
        serve.run_pipeline_witness_stream(handler, {
            "pipelineId": "sharp-image-to-splat-live-v0",
            "source": "/api/read?root=stream-test&path=source.png",
            "outDir": str(out_dir),
        })
    finally:
        serve.BROWSE_ROOTS.clear()
        serve.BROWSE_ROOTS.update(previous_browse)
        if previous_command is None:
            os.environ.pop("KAMINOS_SHARP_COMMAND", None)
        else:
            os.environ["KAMINOS_SHARP_COMMAND"] = previous_command

    lines = [line for line in handler.wfile.getvalue().decode().split("\n") if line.strip()]
    events = [json.loads(line) for line in lines]
    assert events, "the stream wrote nothing"
    progress = [event for event in events if event.get("schema") == "kaminos.pipeline-progress.v0"]
    adapter = [event for event in progress if event.get("kind") == "adapter-progress"]
    assert adapter, f"no adapter progress event reached the stream; schemas seen: {[e.get('schema') for e in events]}"
    final = events[-1]
    assert final.get("schema") == "kaminos.pipeline-run-result.v0", f"the stream must end with the run result, ended with {final.get('schema')}"
    assert final.get("ok") is True, f"the mock run must succeed: {final}"
    assert events.index(adapter[0]) < len(events) - 1, "progress arrives before the final result"
print("pipeline progress stream: adapter progress forwarded and run result final")
