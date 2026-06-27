#!/usr/bin/env python3
"""Text-to-motion generation server for Kaminos.

Wraps Kimodo, HY-Motion, and DiP models behind a simple HTTP API.
Preloads the selected model on startup and serves generation requests.

Usage:
    python motion-serve.py [--port 8091] [--model kimodo]

API:
    GET  /models          -> list available models and their status
    POST /generate        -> generate motion from text prompt
    GET  /health          -> health check
"""

import argparse
import http.server
import json
import os
import sys
import time
import threading
import traceback
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import numpy as np

# ---------- Model backends ----------

class KimodoBackend:
    """Kimodo SOMA-RP-v1.1 text-to-motion."""

    name = "kimodo"
    display_name = "Kimodo SOMA-RP-v1.1"
    skeleton_type = "soma77"
    fps = 30
    max_frames = 600

    def __init__(self):
        self.model = None
        self._lock = threading.Lock()

    def load(self, device="mps"):
        import torch
        kimodo_root = Path(os.environ.get("KIMODO_ROOT", os.path.expanduser("~/dev/kimodo")))
        sys.path.insert(0, str(kimodo_root))
        os.environ.setdefault("TEXT_ENCODER_MODE", "local")
        os.environ.setdefault("CHECKPOINT_DIR", str(kimodo_root / "models"))

        import warnings, logging
        warnings.filterwarnings("ignore")
        logging.disable(logging.WARNING)
        os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"

        from kimodo.model.load_model import load_model
        self.model, _ = load_model(
            "kimodo-soma-rp-v1.1", device=device,
            default_family="Kimodo", return_resolved_name=True,
        )
        self.device = device
        print(f"[motion-serve] Kimodo loaded on {device}")

    def generate(self, prompt, duration=6.0, seed=None, guidance=None, steps=100):
        import torch
        from kimodo.tools import seed_everything
        if seed is not None:
            seed_everything(seed)

        num_frames = int(duration * self.fps)
        num_frames = min(num_frames, self.max_frames)

        kwargs = dict(
            prompts=prompt,
            num_frames=num_frames,
            num_denoising_steps=steps,
            post_processing=False,
            progress_bar=make_progress_callback(steps),
        )
        if guidance is not None:
            kwargs["cfg_weight"] = [guidance, guidance]

        update_progress("encoding", prompt=prompt)
        with self._lock:
            t0 = time.time()
            output = self.model(**kwargs)
            gen_time = time.time() - t0
        update_progress("decoding")

        joints = output["posed_joints"]
        root_pos = output["root_positions"]
        if isinstance(joints, torch.Tensor):
            joints = joints.cpu().numpy()
        if isinstance(root_pos, torch.Tensor):
            root_pos = root_pos.cpu().numpy()

        # SOMA77 parent indices (bone connectivity)
        parents = [-1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 6, 3, 11, 12, 13, 14, 15, 16, 17, 14, 19, 20, 21, 22, 14, 24, 25, 26, 27, 14, 29, 30, 31, 32, 14, 34, 35, 36, 37, 3, 39, 40, 41, 42, 43, 44, 45, 42, 47, 48, 49, 50, 42, 52, 53, 54, 55, 42, 57, 58, 59, 60, 42, 62, 63, 64, 65, 0, 67, 68, 69, 70, 0, 72, 73, 74, 75]

        return {
            "joints": joints.tolist(),  # (N, 77, 3)
            "root_positions": root_pos.tolist(),  # (N, 3)
            "parents": parents,
            "num_frames": joints.shape[0],
            "num_joints": joints.shape[1],
            "fps": self.fps,
            "duration": joints.shape[0] / self.fps,
            "gen_time": round(gen_time, 2),
            "prompt": prompt,
            "model": self.name,
            "skeleton_type": self.skeleton_type,
        }


class DipBackend:
    """DiP/MDM text-to-motion (lightweight, fast)."""

    name = "dip"
    display_name = "DiP (Motion Diffusion)"
    skeleton_type = "humanml22"
    fps = 20
    max_frames = 196

    def __init__(self):
        self.model = None
        self.diffusion = None
        self.data = None
        self._lock = threading.Lock()

    def load(self, device="mps"):
        mdm_root = Path(os.environ.get("MDM_ROOT", os.path.expanduser("~/dev/motion-diffusion-model")))
        sys.path.insert(0, str(mdm_root))
        os.chdir(str(mdm_root))

        from utils import dist_util
        from utils.model_util import create_model_and_diffusion, load_saved_model
        from data_loaders.get_data import get_dataset_loader

        dist_util.setup_dist(device)

        # Load dataset for prefix sampling
        self.data = get_dataset_loader(
            name="humanml", batch_size=1, num_frames=196,
            split="test", hml_mode="train", fixed_len=60, pred_len=40,
            device=dist_util.dev(),
        )

        # Create model
        import json as _json
        model_path = mdm_root / "save/DiP_no-target_10steps_context20_predict40/model000600343.pt"
        args_path = model_path.parent / "args.json"
        with open(args_path) as f:
            model_args = _json.load(f)

        from argparse import Namespace
        args = Namespace(**model_args)
        args.model_path = str(model_path)
        args.batch_size = 1
        args.guidance_param = 7.5
        args.autoregressive = True
        args.use_ema = True

        self.model, self.diffusion = create_model_and_diffusion(args, self.data)
        load_saved_model(self.model, str(model_path), use_avg=True)

        from utils.sampler_util import ClassifierFreeSampleModel
        self.model = ClassifierFreeSampleModel(self.model)
        self.model.to(dist_util.dev())
        self.model.eval()
        self.args = args
        self.device = device
        print(f"[motion-serve] DiP loaded on {device}")

    def generate(self, prompt, duration=6.0, seed=None, guidance=None, steps=None):
        import torch
        from utils import dist_util
        from utils.fixseed import fixseed

        if seed is not None:
            fixseed(seed)

        n_frames = min(int(duration * self.fps), self.max_frames)
        guidance_param = guidance if guidance is not None else 7.5

        # Get prefix from dataset
        iterator = iter(self.data)
        input_motion, model_kwargs = next(iterator)
        input_motion = input_motion.to(dist_util.dev())
        model_kwargs['y']['text'] = [prompt]
        model_kwargs['y'] = {
            k: v.to(dist_util.dev()) if torch.is_tensor(v) else v
            for k, v in model_kwargs['y'].items()
        }
        model_kwargs['y']['scale'] = torch.ones(1, device=dist_util.dev()) * guidance_param
        model_kwargs['y']['text_embed'] = self.model.model.encode_text(model_kwargs['y']['text'])

        from utils.sampler_util import AutoRegressiveSampler
        sample_fn = self.diffusion.p_sample_loop
        sampler = AutoRegressiveSampler(self.args, sample_fn, n_frames)

        with self._lock:
            t0 = time.time()
            sample = sampler.sample(
                self.model,
                (1, self.model.model.njoints, self.model.model.nfeats, n_frames),
                clip_denoised=False,
                model_kwargs=model_kwargs,
                skip_timesteps=0,
                init_image=input_motion.to(dist_util.dev()),
                progress=False,
            )
            gen_time = time.time() - t0

        # Convert to xyz positions
        from data_loaders.humanml.scripts.motion_process import recover_from_ric
        sample = sample.squeeze().permute(1, 0)  # (frames, features)
        n_joints = 22
        motion = recover_from_ric(sample, n_joints).cpu().numpy()  # (frames, joints, 3)

        return {
            "joints": motion.tolist(),
            "num_frames": motion.shape[0],
            "num_joints": motion.shape[1],
            "fps": self.fps,
            "duration": motion.shape[0] / self.fps,
            "gen_time": round(gen_time, 2),
            "prompt": prompt,
            "model": self.name,
            "skeleton_type": self.skeleton_type,
        }


BACKENDS = {
    "kimodo": KimodoBackend,
    "dip": DipBackend,
}

# ---------- Progress tracking ----------

generation_progress = {
    "active": False,
    "step": 0,
    "total_steps": 0,
    "phase": "idle",  # idle, encoding, diffusing, decoding
    "prompt": "",
    "started_at": 0,
}
progress_lock = threading.Lock()

def update_progress(phase, step=0, total=0, prompt=""):
    with progress_lock:
        generation_progress["phase"] = phase
        generation_progress["step"] = step
        generation_progress["total_steps"] = total
        if prompt:
            generation_progress["prompt"] = prompt
        if phase != "idle":
            generation_progress["active"] = True
            if step == 0:
                generation_progress["started_at"] = time.time()
        else:
            generation_progress["active"] = False


def make_progress_callback(total_steps):
    """Return a tqdm-compatible class that updates the progress tracker."""
    class ProgressTracker:
        def __init__(self, iterable=None, total=None, **kwargs):
            self._iterable = iterable
            self._total = total or total_steps
            self._n = 0
            update_progress("diffusing", 0, self._total)
        def __iter__(self):
            for item in self._iterable:
                yield item
                self._n += 1
                update_progress("diffusing", self._n, self._total)
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def update(self, n=1):
            self._n += n
            update_progress("diffusing", self._n, self._total)
    return ProgressTracker


# ---------- HTTP Server ----------

loaded_backend = None
loading_error = None


class MotionHandler(http.server.BaseHTTPRequestHandler):

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json({"status": "ok", "model_loaded": loaded_backend is not None})
        elif parsed.path == "/models":
            self.handle_models()
        elif parsed.path == "/progress":
            with progress_lock:
                elapsed = time.time() - generation_progress["started_at"] if generation_progress["active"] else 0
                self.send_json({**generation_progress, "elapsed": round(elapsed, 1)})
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/generate":
            self.handle_generate()
        elif parsed.path == "/embed":
            self.handle_embed()
        elif parsed.path == "/decode":
            self.handle_decode()
        elif parsed.path == "/denoise_step":
            self.handle_denoise_step()
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_denoise_step(self):
        """Run one denoising step: noisy motion → clean prediction."""
        global loaded_backend
        if loaded_backend is None:
            self.send_json({"error": "No model loaded"}, 503)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except (json.JSONDecodeError, ValueError):
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        import torch
        motion = body.get("motion")       # [N, 369] noisy motion
        text_emb = body.get("text_emb")   # [4096] text embedding
        timestep = body.get("timestep", 0) # mapped timestep
        heading = body.get("heading", 0.0) # first heading angle

        if not motion or not text_emb:
            self.send_json({"error": "motion and text_emb required"}, 400)
            return

        try:
            model = loaded_backend.model
            device = next(model.denoiser.model.root_model.parameters()).device

            motion_t = torch.tensor(motion, dtype=torch.float32).unsqueeze(0).to(device)  # [1, N, 369]
            text_t = torch.tensor(text_emb, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)  # [1, 1, 4096]
            pad_mask = torch.ones(1, motion_t.shape[1], dtype=torch.bool, device=device)
            text_mask = torch.ones(1, 1, dtype=torch.bool, device=device)
            ts = torch.tensor([timestep], device=device)
            heading_t = torch.tensor([heading], dtype=torch.float32, device=device)

            with torch.no_grad():
                pred_clean = model.denoiser(
                    [2.0, 2.0],  # cfg_weight
                    motion_t, pad_mask,
                    text_t, text_mask,
                    ts, heading_t,
                    None, None,  # motion_mask, observed_motion
                )

            result = pred_clean.squeeze(0).cpu().float().numpy().tolist()
            self.send_json({"prediction": result})
        except Exception as e:
            import traceback; traceback.print_exc()
            self.send_json({"error": str(e)}, 500)

    def handle_decode(self):
        """Decode raw body+root model output into joint positions via motion_rep.inverse."""
        global loaded_backend
        if loaded_backend is None:
            self.send_json({"error": "No model loaded"}, 503)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except (json.JSONDecodeError, ValueError):
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        import torch
        body_features = body.get("body_features")  # [N, 364]
        root_features = body.get("root_features")  # [N, 5]
        if not body_features or not root_features:
            self.send_json({"error": "body_features and root_features required"}, 400)
            return

        try:
            model = loaded_backend.model
            motion_rep = model.motion_rep

            # Ensure skeleton is on CPU for decoding
            skel = motion_rep.skeleton
            skel_device = skel.neutral_joints.device if hasattr(skel, 'neutral_joints') else torch.device('cpu')
            if str(skel_device) != 'cpu':
                skel.cpu()

            body_t = torch.tensor(body_features, dtype=torch.float32).unsqueeze(0)  # [1, N, 364]
            root_t = torch.tensor(root_features, dtype=torch.float32).unsqueeze(0)  # [1, N, 5]

            # Combine root + body in the order the denoiser outputs: [root(5), body(364)]
            combined = torch.cat([root_t, body_t], dim=-1)  # [1, N, 369]

            with torch.no_grad():
                output = motion_rep.inverse(combined, is_normalized=True, posed_joints_from="rotations")

            if str(skel_device) != 'cpu':
                skel.to(skel_device)

            joints = output["posed_joints"]
            if isinstance(joints, torch.Tensor):
                joints = joints.cpu().float().numpy()
            root_pos = output["root_positions"]
            if isinstance(root_pos, torch.Tensor):
                root_pos = root_pos.cpu().float().numpy()

            # SOMASkeleton30 parent indices (matches 30-joint output from positions mode)
            parents_30 = [-1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 3, 10, 11, 12, 13, 13, 3, 16, 17, 18, 19, 19, 0, 22, 23, 24, 0, 26, 27, 28]

            j = joints.squeeze(0)
            r = root_pos.squeeze(0)
            self.send_json({
                "joints": j.tolist(),
                "root_positions": r.tolist(),
                "parents": parents_30,
                "num_frames": j.shape[0],
                "num_joints": j.shape[1] if j.ndim > 1 else 30,
            })
        except Exception as e:
            import traceback; traceback.print_exc()
            self.send_json({"error": str(e)}, 500)

    def handle_embed(self):
        """Return text embedding vector for WebGPU client-side diffusion."""
        global loaded_backend
        if loaded_backend is None or not hasattr(loaded_backend, 'model'):
            self.send_json({"error": "No model loaded"}, 503)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except (json.JSONDecodeError, ValueError):
            self.send_json({"error": "Invalid JSON"}, 400)
            return
        prompt = body.get("prompt", "").strip()
        if not prompt:
            self.send_json({"error": "prompt required"}, 400)
            return
        try:
            import torch
            model = loaded_backend.model
            text_feat = model.text_encoder([prompt])
            if isinstance(text_feat, tuple):
                text_feat = text_feat[0]
            if isinstance(text_feat, torch.Tensor):
                text_feat = text_feat.cpu().float().numpy()
            flat = text_feat.flatten().tolist()
            self.send_json({"embedding": flat, "dim": len(flat), "shape": list(text_feat.shape)})
        except Exception as e:
            import traceback; traceback.print_exc()
            self.send_json({"error": str(e)}, 500)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def handle_models(self):
        models = []
        for key, cls in BACKENDS.items():
            models.append({
                "id": key,
                "name": cls.display_name,
                "skeleton_type": cls.skeleton_type,
                "fps": cls.fps,
                "max_frames": cls.max_frames,
                "loaded": loaded_backend is not None and loaded_backend.name == key,
            })
        self.send_json({"models": models})

    def handle_generate(self):
        global loaded_backend
        if loaded_backend is None:
            self.send_json({"error": "No model loaded", "loading_error": str(loading_error)}, 503)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except (json.JSONDecodeError, ValueError):
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        prompt = body.get("prompt", "").strip()
        if not prompt:
            self.send_json({"error": "prompt required"}, 400)
            return

        duration = float(body.get("duration", 6.0))
        seed = body.get("seed")
        if seed is not None:
            seed = int(seed)
        guidance = body.get("guidance")
        if guidance is not None:
            guidance = float(guidance)
        steps = body.get("steps")
        if steps is not None:
            steps = int(steps)

        try:
            result = loaded_backend.generate(
                prompt=prompt,
                duration=duration,
                seed=seed,
                guidance=guidance,
                steps=steps or 100,
            )
            update_progress("idle")
            self.send_json(result)
        except Exception as e:
            update_progress("idle")
            traceback.print_exc()
            self.send_json({"error": str(e)}, 500)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        rendered = format % args if args else format
        if "OPTIONS" in rendered:
            return
        print(f"[motion-serve] {rendered}")


def main():
    global loaded_backend, loading_error

    parser = argparse.ArgumentParser(description="Kaminos text-to-motion server")
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--model", type=str, default="kimodo", choices=list(BACKENDS.keys()))
    parser.add_argument("--device", type=str, default="auto")
    args = parser.parse_args()

    if args.device == "auto":
        import torch
        if torch.cuda.is_available():
            device = "cuda:0"
        elif torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    else:
        device = args.device

    print(f"[motion-serve] Loading {args.model} on {device}...")
    try:
        backend_cls = BACKENDS[args.model]
        backend = backend_cls()
        backend.load(device=device)
        loaded_backend = backend
        print(f"[motion-serve] Ready.")
    except Exception as e:
        loading_error = e
        traceback.print_exc()
        print(f"[motion-serve] Failed to load model: {e}")
        print(f"[motion-serve] Server will start but generation will fail.")

    server = http.server.ThreadingHTTPServer(("", args.port), MotionHandler)
    print(f"[motion-serve] Listening on http://localhost:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[motion-serve] Stopped.")


if __name__ == "__main__":
    main()
