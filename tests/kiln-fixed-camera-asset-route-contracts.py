from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


EXPECTED_RECONSTRUCTION_ROOT = (
    Path.home() / ".local/state/kaminos/assets/reconstructions"
).resolve()
NORMAL_ROUTE = (
    "/api/read?root=reconstructions&"
    "path=kiln-room-pre-ignition-source-v1%2Flotus-normal-v1%2Fnormal.png"
)


def test_reconstruction_assets_have_a_caller_addressed_read_root():
    assert serve.BROWSE_ROOTS["reconstructions"].resolve() == EXPECTED_RECONSTRUCTION_ROOT
    assert serve._resolve_api_read_source(NORMAL_ROUTE) == (
        EXPECTED_RECONSTRUCTION_ROOT
        / "kiln-room-pre-ignition-source-v1/lotus-normal-v1/normal.png"
    )


def test_reconstruction_read_root_rejects_traversal():
    try:
        serve._resolve_api_read_source(
            "/api/read?root=reconstructions&path=..%2Fimages%2Finbox%2Fkiln-room-pre-ignition-source-v1.png"
        )
    except PermissionError as error:
        assert str(error) == "Path traversal"
    else:
        raise AssertionError("reconstruction read root accepted path traversal")


if __name__ == "__main__":
    test_reconstruction_assets_have_a_caller_addressed_read_root()
    test_reconstruction_read_root_rejects_traversal()
    print("kiln fixed-camera asset route contracts passed")
