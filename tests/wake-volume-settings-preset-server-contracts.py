import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from urllib.error import HTTPError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]


def _free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_for_server(port, process):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"serve.py exited before listening: {process.returncode}")
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/runtime-config", timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise AssertionError("serve.py did not listen within five seconds")


def test_missing_shared_preset_fails_as_json_from_the_consumer_api():
    with TemporaryDirectory() as temporary:
        port = _free_port()
        env = {
            **os.environ,
            "KAMINOS_VOLUME_SETTINGS_STORE": str(Path(temporary) / "presets"),
        }
        process = subprocess.Popen(
            [sys.executable, "serve.py", str(port)],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            _wait_for_server(port, process)
            try:
                urlopen(
                    f"http://127.0.0.1:{port}/api/volume-settings-preset?id=missing-basin",
                    timeout=2,
                )
            except HTTPError as error:
                body = json.loads(error.read())
                assert error.code == 404
                assert body["requestedPresetRef"] == "missing-basin"
                assert body["failurePhase"] == "shared-preset-read"
                assert body["storePath"] == str(Path(env["KAMINOS_VOLUME_SETTINGS_STORE"]).resolve())
            else:
                raise AssertionError("missing preset must fail loud")
        finally:
            process.terminate()
            process.wait(timeout=5)


if __name__ == "__main__":
    test_missing_shared_preset_fails_as_json_from_the_consumer_api()
