#!/usr/bin/env python3
"""Poll Kaminos webcam frames, run WiLoR-MLX, and post live hand packets."""

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


PERCEPTASIA_HAND_CONTROL_SCHEMA = "perceptasia.hand-control.v0"
BACKEND_IDENTITY = "native_wilor_mini_mlx_detector_sidecar_live"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="http://127.0.0.1:8096")
    parser.add_argument("--frame-dir", default="~/.local/state/kaminos/hand-control-native-frames")
    parser.add_argument("--mlx-root", default="~/dev/wilor-mlx")
    parser.add_argument("--mano-path", default="")
    parser.add_argument("--poll-ms", type=float, default=45.0)
    parser.add_argument("--hand-conf", type=float, default=0.18)
    parser.add_argument("--max-input-age-ms", type=float, default=850.0)
    parser.add_argument("--include-vertices", action="store_true")
    parser.add_argument("--once", action="store_true")
    return parser.parse_args()


def load_wilor_pipeline(mlx_root, mano_path=""):
    mlx_root = Path(mlx_root).expanduser().resolve()
    sys.path.insert(0, str(mlx_root / "src"))
    from wilor_mlx.detector import HandDetector  # pylint: disable=import-error,import-outside-toplevel
    from wilor_mlx.model import WiLoR  # pylint: disable=import-error,import-outside-toplevel
    from wilor_mlx.pipeline import HandPosePipeline  # pylint: disable=import-error,import-outside-toplevel

    cache_mano_path = Path(os.path.expanduser("~/.cache/wilor-mlx/mano.npz"))
    repo_mano_path = mlx_root / "weights" / "mano.npz"
    explicit_mano_path = Path(mano_path).expanduser() if mano_path else (
        cache_mano_path if cache_mano_path.is_file() else repo_mano_path
    )
    detector = HandDetector.from_pretrained()
    if explicit_mano_path.is_file():
        pose_model = WiLoR.from_pretrained(mano_path=str(explicit_mano_path))
    else:
        pose_model = WiLoR.from_pretrained()
    return HandPosePipeline(detector, pose_model), mlx_root


def read_latest_frame(frame_dir):
    frame_dir = Path(frame_dir).expanduser()
    metadata_path = frame_dir / "latest.json"
    if not metadata_path.is_file():
        return None
    try:
        metadata = json.loads(metadata_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    filename = metadata.get("frame_filename") or "latest.jpg"
    frame_path = frame_dir / Path(filename).name
    if not frame_path.is_file():
        return None
    signature = (
        metadata.get("capture_id"),
        frame_path.stat().st_mtime_ns,
        frame_path.stat().st_size,
    )
    return metadata, frame_path, signature


def post_json(url, payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Content-Length": str(len(body))},
    )
    with urllib.request.urlopen(request, timeout=2.5) as response:
        return response.status, response.read().decode("utf-8", errors="replace")


def finite(value, fallback=0.0):
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if math.isfinite(parsed) else fallback


def vec(values):
    return {"x": finite(values[0]), "y": finite(values[1]), "z": finite(values[2])}


def vec2(values, width, height):
    width = max(1.0, finite(width, 1.0))
    height = max(1.0, finite(height, 1.0))
    return {"x": finite(values[0]) / width, "y": finite(values[1]) / height}


def sub(a, b):
    return [finite(a[index]) - finite(b[index]) for index in range(3)]


def cross(a, b):
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def norm(a):
    length = math.sqrt(sum(item * item for item in a))
    if length <= 1e-8:
        return [0.0, 0.0, 1.0]
    return [item / length for item in a]


def distance(a, b):
    return math.sqrt(sum((finite(a[index]) - finite(b[index])) ** 2 for index in range(min(len(a), len(b)))))


def face_indices(pipeline):
    mano = getattr(getattr(pipeline, "pose_model", None), "mano", None)
    faces = getattr(mano, "faces", None)
    if faces is None:
        return []
    if hasattr(faces, "tolist"):
        faces = faces.tolist()
    return [[int(face[0]), int(face[1]), int(face[2])] for face in faces if len(face) >= 3]


def hand_to_packet(hand, metadata, image_shape, *, model_latency_ms, faces):
    image_height, image_width = image_shape[:2]
    keypoints_2d = getattr(hand, "keypoints_2d", None)
    keypoints_3d = getattr(hand, "keypoints_3d", None)
    vertices = getattr(hand, "vertices", None)
    if hasattr(keypoints_2d, "tolist"):
        keypoints_2d = keypoints_2d.tolist()
    if hasattr(keypoints_3d, "tolist"):
        keypoints_3d = keypoints_3d.tolist()
    if hasattr(vertices, "tolist"):
        vertices = vertices.tolist()
    keypoints_2d = keypoints_2d or []
    keypoints_3d = keypoints_3d or [[point[0] / max(1, image_width), point[1] / max(1, image_height), 0.0] for point in keypoints_2d]
    landmarks_2d = [vec2(point, image_width, image_height) for point in keypoints_2d[:21]]
    landmarks_3d = [vec(point) for point in keypoints_3d[:21]]
    palm_indices = [0, 5, 9, 13, 17]
    palm_center = {
        "x": sum(landmarks_2d[index]["x"] for index in palm_indices if index < len(landmarks_2d)) / len(palm_indices),
        "y": sum(landmarks_2d[index]["y"] for index in palm_indices if index < len(landmarks_2d)) / len(palm_indices),
    } if len(landmarks_2d) >= 18 else {"x": 0.5, "y": 0.5}

    wrist = keypoints_3d[0] if len(keypoints_3d) > 0 else [0, 0, 0]
    index_mcp = keypoints_3d[5] if len(keypoints_3d) > 5 else [1, 0, 0]
    pinky_mcp = keypoints_3d[17] if len(keypoints_3d) > 17 else [0, 1, 0]
    x_axis = norm(sub(index_mcp, pinky_mcp))
    y_axis = norm(sub(keypoints_3d[9] if len(keypoints_3d) > 9 else index_mcp, wrist))
    z_axis = norm(cross(x_axis, y_axis))

    fingertip_ids = [4, 8, 12, 16, 20]
    mcp_ids = [2, 5, 9, 13, 17]
    finger_lengths = [
        distance(keypoints_3d[tip], keypoints_3d[mcp])
        for tip, mcp in zip(fingertip_ids, mcp_ids)
        if tip < len(keypoints_3d) and mcp < len(keypoints_3d)
    ]
    palm_width = distance(index_mcp, pinky_mcp) or 1.0
    openness = max(0.0, min(1.0, (sum(finger_lengths) / max(1, len(finger_lengths))) / max(1e-5, palm_width)))
    pinch_distance = distance(keypoints_3d[4], keypoints_3d[8]) if len(keypoints_3d) > 8 else 0.0
    spread = distance(keypoints_3d[4], keypoints_3d[20]) if len(keypoints_3d) > 20 else 0.0
    fist_score = max(0.0, min(1.0, 1.0 - openness))

    dense_mano = None
    if vertices and faces:
        dense_mano = {
            "schema": "kaminos.wilor-mlx.mano-surface.v0",
            "coordinate_space": "wilor_mlx_hand_local",
            "vertices": [[finite(item[0]), finite(item[1]), finite(item[2])] for item in vertices],
            "faces": faces,
        }

    capture_timestamp_ms = metadata.get("capture_timestamp_ms")
    timestamp = finite(capture_timestamp_ms, time.time() * 1000.0)
    frame_id = str(metadata.get("capture_id") or metadata.get("frame_id") or time.time_ns())
    return {
        "schema": PERCEPTASIA_HAND_CONTROL_SCHEMA,
        "source_backend": BACKEND_IDENTITY,
        "timestamp": timestamp,
        "frame_id": frame_id,
        "handedness": getattr(hand, "hand_side", None) or "unknown",
        "confidence": finite(getattr(hand, "confidence", 0.0)),
        "video_size": {
            "width": int(metadata.get("source_video_width") or image_width),
            "height": int(metadata.get("source_video_height") or image_height),
        },
        "palm_center": palm_center,
        "landmarks_2d": landmarks_2d,
        "landmarks_3d": landmarks_3d,
        "world_landmarks": landmarks_3d,
        "mano": dense_mano,
        "dense_mano": dense_mano,
        "palm_normal_proxy": vec(z_axis),
        "hand_frame_basis": {
            "source": BACKEND_IDENTITY,
            "x_axis": vec(x_axis),
            "y_axis": vec(y_axis),
            "z_axis": vec(z_axis),
        },
        "openness": openness,
        "pinch_distance": pinch_distance,
        "fist_score": fist_score,
        "spread": spread,
        "velocity": {"x_px_per_s": 0, "y_px_per_s": 0, "px_per_s": 0},
        "jitter_px": 0,
        "mode_suggestion": "live_surface",
        "native_frame_timing": {
            "capture_timestamp_ms": capture_timestamp_ms,
            "capture_epoch_ms": metadata.get("capture_epoch_ms"),
            "sidecar_received_epoch_ms": time.time() * 1000.0,
            "model_latency_ms": model_latency_ms,
        },
        "webcam_frame": {
            "visible": True,
            "synthetic": False,
            "width": int(metadata.get("source_video_width") or image_width),
            "height": int(metadata.get("source_video_height") or image_height),
            "frame_ref": frame_id,
        },
        "debug": {
            "dropped_frames": 0,
            "tracking_resets": 0,
            "relocalization": False,
            "backend_errors": [],
            "evidence_route": BACKEND_IDENTITY,
            "model_route": "wilor-mlx HandPosePipeline.from_pretrained",
            "device_route": "mlx",
            "telemetry": {
                "model_latency_ms": model_latency_ms,
                "frame_age_ms": max(0.0, time.time() * 1000.0 - finite(metadata.get("stored_at_ms"), time.time() * 1000.0)),
                "include_vertices": bool(dense_mano),
            },
        },
    }


def main():
    args = parse_args()
    pipeline, mlx_root = load_wilor_pipeline(args.mlx_root, args.mano_path)
    faces = face_indices(pipeline)
    print(json.dumps({
        "event": "sidecar_started",
        "backend": BACKEND_IDENTITY,
        "mlx_root": str(mlx_root),
        "faces": len(faces),
        "include_vertices": args.include_vertices,
    }), flush=True)

    import cv2  # pylint: disable=import-error,import-outside-toplevel

    seen_signature = None
    frame_dir = Path(args.frame_dir).expanduser()
    while True:
        latest = read_latest_frame(frame_dir)
        if latest:
            metadata, frame_path, signature = latest
            frame_age_ms = time.time() * 1000.0 - finite(metadata.get("stored_at_ms"), time.time() * 1000.0)
            if signature != seen_signature and frame_age_ms <= args.max_input_age_ms:
                seen_signature = signature
                image_bgr = cv2.imread(str(frame_path), cv2.IMREAD_COLOR)
                if image_bgr is not None:
                    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
                    started = time.perf_counter()
                    hands = pipeline(
                        image_rgb,
                        conf_threshold=args.hand_conf,
                        include_3d=True,
                        include_vertices=args.include_vertices,
                    )
                    model_latency_ms = (time.perf_counter() - started) * 1000.0
                    if hands:
                        hand = max(hands, key=lambda item: finite(getattr(item, "confidence", 0.0)))
                        packet = hand_to_packet(
                            hand,
                            metadata,
                            image_rgb.shape,
                            model_latency_ms=model_latency_ms,
                            faces=faces if args.include_vertices else [],
                        )
                        try:
                            status, body = post_json(f"{args.server.rstrip('/')}/hand-control-sidecar-event", packet)
                            print(json.dumps({
                                "event": "posted_hand_packet",
                                "status": status,
                                "frame_id": packet["frame_id"],
                                "latency_ms": round(model_latency_ms, 3),
                                "response": body[:240],
                            }), flush=True)
                        except urllib.error.URLError as error:
                            print(json.dumps({"event": "post_failed", "error": str(error)}), flush=True)
                    else:
                        print(json.dumps({
                            "event": "no_hand",
                            "capture_id": metadata.get("capture_id"),
                            "latency_ms": round(model_latency_ms, 3),
                        }), flush=True)
            elif signature != seen_signature and frame_age_ms > args.max_input_age_ms:
                seen_signature = signature
                print(json.dumps({
                    "event": "stale_frame_skipped",
                    "capture_id": metadata.get("capture_id"),
                    "frame_age_ms": round(frame_age_ms, 3),
                }), flush=True)
        if args.once:
            break
        time.sleep(max(0.005, args.poll_ms / 1000.0))


if __name__ == "__main__":
    main()
