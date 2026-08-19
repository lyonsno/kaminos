"""Hydrostat carrier compiler: chamber-chain morphology -> posed mesh + receipt.

Carrier language for the hydrostatic (pressure-vessel) creature taxonomy.
Morphology is a chain of chambers (rest volume, semi-length, septum depth).
Pose is a pressure schedule compiled from posture phonemes (pool, erect, lean,
compress, wave) over the same chambers. The factorization law is volume
invariance: per-chamber rest volume is morphology; turgor, eccentricity, and
spline are pose/state, and total volume is conserved by construction.

File-in/file-out contract: a spec JSON in, a posed JSON + OBJ mesh + receipt
out, all paths caller-owned. Deterministic: identical spec bytes produce
identical output bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

PHONEMES = ("pool", "erect", "lean", "compress", "wave")

# Fraction of the neighbor-pair semi-length by which adjacent chambers overlap
# at a fully open septum (septum_depth == 0). Deeper septa reduce overlap,
# deepening the waist the max-envelope loft produces between chambers.
MAX_SEPTUM_OVERLAP = 0.35

RINGS_PER_CHAMBER = 16
RING_SEGMENTS = 24

ERECT_MAX_PITCH = math.radians(72.0)
CONTACT_FACET_FRACTION = 0.35

# Statics laws: how strongly supported load thickens a chamber, the maximum
# bend between adjacent chambers (droop bound), and the lean-search window for
# putting the center of mass over the support patch.
LOAD_GIRTH_GAIN = 0.55
MAX_BEND = math.radians(34.0)
# Lean window is asymmetric: a rearing hydrostat can curl far back over its
# own support patch, but pitching much further forward only topples it.
LEAN_SEARCH = [(-0.4 + 1.6 * k / 60.0) for k in range(61)]
GROUND_EPS_FRACTION = 0.08


class SpecError(ValueError):
    """Raised when a carrier spec violates the contract."""


@dataclass
class Chamber:
    rest_volume: float
    semi_length: float
    septum_depth: float  # depth of the septum AFTER this chamber, 0..1


@dataclass
class PosedChamber:
    index: int
    volume: float
    turgor: float
    semi_length: float
    radius: float
    eccentricity: float
    contact: bool
    center: tuple
    tangent: tuple


@dataclass
class Carrier:
    name: str
    chambers: list
    posture: list = field(default_factory=list)


def load_spec(raw: dict) -> Carrier:
    if not isinstance(raw, dict):
        raise SpecError("spec must be a JSON object")
    name = raw.get("name")
    if not isinstance(name, str) or not name:
        raise SpecError("spec.name must be a non-empty string")
    chambers_raw = raw.get("chambers")
    if not isinstance(chambers_raw, list) or len(chambers_raw) < 2:
        raise SpecError("spec.chambers must be a list of at least 2 chambers")
    chambers = []
    for i, c in enumerate(chambers_raw):
        try:
            rest_volume = float(c["rest_volume"])
            semi_length = float(c["semi_length"])
            septum_depth = float(c.get("septum_depth", 0.5))
        except (KeyError, TypeError, ValueError) as exc:
            raise SpecError(f"chamber {i}: {exc}") from exc
        if rest_volume <= 0 or semi_length <= 0:
            raise SpecError(f"chamber {i}: rest_volume and semi_length must be > 0")
        if not 0.0 <= septum_depth <= 1.0:
            raise SpecError(f"chamber {i}: septum_depth must be in [0, 1]")
        chambers.append(Chamber(rest_volume, semi_length, septum_depth))
    posture = raw.get("posture", [])
    if not isinstance(posture, list):
        raise SpecError("spec.posture must be a list")
    for i, p in enumerate(posture):
        if not isinstance(p, dict) or p.get("phoneme") not in PHONEMES:
            raise SpecError(f"posture {i}: phoneme must be one of {PHONEMES}")
        start = float(p.get("start", 0.0))
        end = float(p.get("end", 1.0))
        if not (0.0 <= start < end <= 1.0):
            raise SpecError(f"posture {i}: need 0 <= start < end <= 1")
    return Carrier(name=name, chambers=chambers, posture=posture)


def _chamber_positions(n: int) -> list:
    """Normalized body coordinate of each chamber center, tail=0 head=1."""
    if n == 1:
        return [0.5]
    return [i / (n - 1) for i in range(n)]


RAMP_MARGIN = 0.12


def _phoneme_weight(p: dict, u: float) -> float:
    start, end = float(p.get("start", 0.0)), float(p.get("end", 1.0))
    if u < start or u > end:
        return 0.0
    # Full weight in the region interior; smooth taper only at boundaries that
    # are interior to the body, so a region touching the tail (0) or head (1)
    # keeps full authority over the terminal chamber.
    w = 1.0
    if start > 0.0 and u - start < RAMP_MARGIN:
        t = (u - start) / RAMP_MARGIN
        w = min(w, 0.5 - 0.5 * math.cos(t * math.pi))
    if end < 1.0 and end - u < RAMP_MARGIN:
        t = (end - u) / RAMP_MARGIN
        w = min(w, 0.5 - 0.5 * math.cos(t * math.pi))
    return w


def compile_pose(carrier: Carrier) -> list:
    """Compile posture phonemes into per-chamber (turgor, eccentricity,
    contact, pitch) channels, then normalize turgor so total volume is
    conserved exactly."""
    n = len(carrier.chambers)
    positions = _chamber_positions(n)
    turgor = [1.0] * n
    eccentricity = [0.0] * n
    contact = [False] * n
    pitch = [0.0] * n  # radians above horizontal for the local tangent

    for p in carrier.posture:
        phoneme = p["phoneme"]
        amount = float(p.get("amount", 1.0))
        for i, u in enumerate(positions):
            w = _phoneme_weight(p, u) * amount
            if w <= 0.0:
                continue
            if phoneme == "pool":
                turgor[i] *= 1.0 - 0.45 * w
                eccentricity[i] += 0.8 * w
                if w > 0.2:
                    contact[i] = True
                pitch[i] += 0.0
            elif phoneme == "erect":
                turgor[i] *= 1.0 + 0.35 * w
                eccentricity[i] *= max(0.0, 1.0 - w)
                pitch[i] += ERECT_MAX_PITCH * w
            elif phoneme == "compress":
                turgor[i] *= 1.0 - 0.6 * w
            elif phoneme == "lean":
                pitch[i] += math.radians(20.0) * w * math.copysign(1.0, amount)
            elif phoneme == "wave":
                phase = float(p.get("phase", 0.0))
                bulge = math.exp(-((u - phase) ** 2) / 0.02)
                turgor[i] *= 1.0 + 0.5 * w * bulge

    # Volume-conservation law: morphology owns total volume; pose only
    # redistributes it. Normalize so sum(turgor_i * rest_volume_i) == sum(rest_volume_i).
    rest = [c.rest_volume for c in carrier.chambers]
    total_rest = sum(rest)
    total_posed = sum(t * v for t, v in zip(turgor, rest))
    scale = total_rest / total_posed
    turgor = [t * scale for t in turgor]

    return [
        {
            "turgor": turgor[i],
            "eccentricity": eccentricity[i],
            "contact": contact[i],
            "pitch": pitch[i],
        }
        for i in range(n)
    ]


def _chain_centers(carrier: Carrier, pitches: list) -> tuple:
    """Chamber centers and tangents for a given per-chamber pitch sequence."""
    centers = []
    tangents = []
    x, y = 0.0, 0.0
    for i, c in enumerate(carrier.chambers):
        t = (math.cos(pitches[i]), math.sin(pitches[i]))
        if i > 0:
            prev = carrier.chambers[i - 1]
            overlap = MAX_SEPTUM_OVERLAP * (1.0 - prev.septum_depth)
            spacing = (prev.semi_length + c.semi_length) * (1.0 - overlap)
            x += t[0] * spacing
            y += t[1] * spacing
        centers.append((x, y))
        tangents.append(t)
    return centers, tangents


def apply_statics(carrier: Carrier, channels: list) -> list:
    """Deterministic statics laws over the compiled pose channels.

    1. Droop bound: adjacent chambers may not differ in pitch by more than
       MAX_BEND, so the spine curves instead of kinking.
    2. Load-proportional girth: each chamber's turgor gains with the mass it
       supports (masses of chambers after it, weighted by how vertical the
       chain is there), then turgor is re-normalized so total volume is still
       conserved exactly. This produces the basal bulge and upward taper.
    3. COM-over-support: a single lean scalar applied to non-contact chambers
       is searched so the volume-weighted center of mass projects as close as
       possible to the middle of the ground-contact patch.
    """
    n = len(channels)
    # 1. Droop bound.
    for i in range(1, n):
        lo = channels[i - 1]["pitch"] - MAX_BEND
        hi = channels[i - 1]["pitch"] + MAX_BEND
        channels[i]["pitch"] = min(max(channels[i]["pitch"], lo), hi)

    # 2. Load-proportional girth.
    masses = [c.rest_volume for c in carrier.chambers]
    total_mass = sum(masses)
    for i in range(n):
        load = sum(
            masses[j] * math.sin(channels[j]["pitch"]) for j in range(i + 1, n)
        )
        channels[i]["turgor"] *= 1.0 + LOAD_GIRTH_GAIN * max(load, 0.0) / total_mass
    rest = [c.rest_volume for c in carrier.chambers]
    total_posed = sum(ch["turgor"] * v for ch, v in zip(channels, rest))
    scale = sum(rest) / total_posed
    for ch in channels:
        ch["turgor"] *= scale

    # 3. COM-over-support. Support is geometric: every chamber whose underside
    # rests on the ground after the trial pose is grounded, not only the
    # phoneme-flagged contact chambers. The objective is containment (zero
    # inside the patch, distance to the nearest edge outside), tie-broken
    # toward the smallest lean.
    radii = [
        math.sqrt(3.0 * ch["turgor"] * v / (4.0 * math.pi * c.semi_length))
        for ch, v, c in zip(channels, rest, carrier.chambers)
    ]

    def com_penalty(lean: float) -> float:
        pitches = [
            ch["pitch"] + (0.0 if ch["contact"] else lean) for ch in channels
        ]
        centers, _ = _chain_centers(carrier, pitches)
        undersides = [
            centers[i][1] - radii[i] / (1.0 + channels[i]["eccentricity"])
            for i in range(n)
        ]
        floor = min(undersides)
        grounded = [
            i
            for i in range(n)
            if undersides[i] - floor <= GROUND_EPS_FRACTION * radii[i]
        ] or [0]
        lo = min(centers[i][0] - carrier.chambers[i].semi_length for i in grounded)
        hi = max(centers[i][0] + carrier.chambers[i].semi_length for i in grounded)
        com_x = sum(
            cx * ch["turgor"] * m for (cx, _), ch, m in zip(centers, channels, rest)
        ) / sum(ch["turgor"] * m for ch, m in zip(channels, rest))
        return max(lo - com_x, com_x - hi, 0.0)

    best = min(LEAN_SEARCH, key=lambda lean: (com_penalty(lean), abs(lean)))
    for ch in channels:
        if not ch["contact"]:
            ch["pitch"] += best
    return channels


def pose_carrier(carrier: Carrier) -> list:
    """Produce posed chambers: volumes, radii, centers along the posed spline."""
    channels = apply_statics(carrier, compile_pose(carrier))
    posed = []
    # Ellipsoid volume v = (4/3) * pi * a * b * c with b*c = r^2, so
    # r = sqrt(3 v / (4 pi a)). Eccentricity trades b against c while
    # preserving b*c, so it never changes volume.
    radii = []
    for c, ch in zip(carrier.chambers, channels):
        v = c.rest_volume * ch["turgor"]
        r = math.sqrt(3.0 * v / (4.0 * math.pi * c.semi_length))
        radii.append(r)

    centers, tangents = _chain_centers(
        carrier, [ch["pitch"] for ch in channels]
    )

    # Ground the body: contact chambers rest on y=0 with a facet; if no
    # chamber has contact, ground the lowest chamber's underside.
    contact_idx = [i for i, ch in enumerate(channels) if ch["contact"]]
    idx = contact_idx if contact_idx else list(range(len(centers)))
    floor = min(
        centers[i][1] - radii[i] / (1.0 + channels[i]["eccentricity"]) for i in idx
    )
    centers = [(cx, cy - floor) for cx, cy in centers]

    for i, (c, ch) in enumerate(zip(carrier.chambers, channels)):
        posed.append(
            PosedChamber(
                index=i,
                volume=c.rest_volume * ch["turgor"],
                turgor=ch["turgor"],
                semi_length=c.semi_length,
                radius=radii[i],
                eccentricity=ch["eccentricity"],
                contact=ch["contact"],
                center=(centers[i][0], centers[i][1], 0.0),
                tangent=(tangents[i][0], tangents[i][1], 0.0),
            )
        )
    return posed


def _arc_stations(posed: list) -> list:
    """Sampling stations along the chamber chain: (chamber, local axial coord)."""
    stations = []
    first, last = posed[0], posed[-1]
    for pc in posed:
        for k in range(RINGS_PER_CHAMBER):
            t = (k + 0.5) / RINGS_PER_CHAMBER
            stations.append((pc, (t - 0.5) * 2.0 * pc.semi_length))
    return stations


def _envelope_radius(posed: list, world_axial: float, axials: list) -> float:
    """Max-envelope of chamber ellipse profiles at a global axial coordinate."""
    best = 0.0
    for pc, a0 in zip(posed, axials):
        d = (world_axial - a0) / pc.semi_length
        if abs(d) < 1.0:
            best = max(best, pc.radius * math.sqrt(1.0 - d * d))
    return best


def _blend_channel(posed: list, axials: list, q: float, getter) -> float:
    """Linearly blend a per-chamber channel along the axial coordinate."""
    if q <= axials[0]:
        return getter(posed[0])
    if q >= axials[-1]:
        return getter(posed[-1])
    for i in range(len(axials) - 1):
        if axials[i] <= q <= axials[i + 1]:
            span = axials[i + 1] - axials[i]
            t = (q - axials[i]) / span if span > 0 else 0.0
            return getter(posed[i]) * (1.0 - t) + getter(posed[i + 1]) * t
    raise AssertionError("unreachable")


def generate_mesh(posed: list) -> tuple:
    """Loft one continuous closed tube over the chamber chain.

    Stations are sampled uniformly in the axial coordinate from tail cap to
    head cap; each station's radius is the max-envelope of the chamber
    ellipse profiles, so septa appear as waists, never as gaps. Cross-sections
    are ellipses (b = r*(1+e) lateral, c = r/(1+e) vertical, area-preserving
    in e). Stations in contact regions get their under-side softly clamped
    toward the ground plane to form the facet.
    """
    axials = [0.0]
    for i in range(1, len(posed)):
        axials.append(axials[-1] + math.dist(posed[i - 1].center, posed[i].center))

    q_start = axials[0] - posed[0].semi_length
    q_end = axials[-1] + posed[-1].semi_length
    n_stations = len(posed) * RINGS_PER_CHAMBER

    # Smooth centerline: blend the per-chamber pitch angle continuously along
    # the axial coordinate and integrate it, so chamber boundaries are bends,
    # not kinks.
    def station_q(k: int) -> float:
        return q_start + (q_end - q_start) * (k + 0.5) / n_stations

    def pitch_of(pc: PosedChamber) -> float:
        return math.atan2(pc.tangent[1], pc.tangent[0])

    centers = []
    tangents2d = []
    x, y = 0.0, 0.0
    prev_q = station_q(0)
    for k in range(n_stations):
        q = station_q(k)
        theta = _blend_channel(posed, axials, q, pitch_of)
        tx, ty = math.cos(theta), math.sin(theta)
        if k > 0:
            dq = q - prev_q
            x += tx * dq
            y += ty * dq
        centers.append((x, y))
        tangents2d.append((tx, ty))
        prev_q = q

    stations = []
    for k in range(n_stations):
        q = station_q(k)
        r = _envelope_radius(posed, q, axials)
        if r <= 1e-9:
            continue
        ecc = _blend_channel(posed, axials, q, lambda pc: pc.eccentricity)
        contact_w = _blend_channel(
            posed, axials, q, lambda pc: 1.0 if pc.contact else 0.0
        )
        stations.append((centers[k], tangents2d[k], r, ecc, contact_w))

    # Ground the smoothed body: the underside of contact stations (or the
    # whole body when no station has contact) rests on y = 0.
    grounded = [s for s in stations if s[4] > 0.5] or stations
    floor = min(cy - r / (1.0 + ecc) for (cx, cy), _, r, ecc, _ in grounded)

    vertices = []
    rings = []
    for (cx, cy), (tx, ty), r, ecc, contact_w in stations:
        cy -= floor
        b = r * (1.0 + ecc)
        c = r / (1.0 + ecc)
        ux, uy = -ty, tx  # in-plane normal to the tangent ("up"-ish)
        ring = []
        for s in range(RING_SEGMENTS):
            phi = 2.0 * math.pi * s / RING_SEGMENTS
            lz = b * math.cos(phi)
            off = c * math.sin(phi)
            vx = cx + ux * off
            vy = cy + uy * off
            vz = lz
            if contact_w > 0.5 and vy < 0.0:
                vy *= CONTACT_FACET_FRACTION  # soft clamp: flattened facet
            ring.append(len(vertices))
            vertices.append((vx, vy, vz))
        rings.append(ring)

    faces = []
    for ri in range(len(rings) - 1):
        a, bring = rings[ri], rings[ri + 1]
        for s in range(RING_SEGMENTS):
            s2 = (s + 1) % RING_SEGMENTS
            faces.append((a[s], a[s2], bring[s2]))
            faces.append((a[s], bring[s2], bring[s]))
    # End caps: triangle fans to ring centroids.
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        cx = sum(vertices[i][0] for i in ring) / len(ring)
        cy = sum(vertices[i][1] for i in ring) / len(ring)
        cz = sum(vertices[i][2] for i in ring) / len(ring)
        centroid = len(vertices)
        vertices.append((cx, cy, cz))
        for s in range(RING_SEGMENTS):
            s2 = (s + 1) % RING_SEGMENTS
            tri = (centroid, ring[s2], ring[s]) if flip else (centroid, ring[s], ring[s2])
            faces.append(tri)
    return vertices, faces


def mesh_volume(vertices: list, faces: list) -> float:
    """Signed volume via divergence theorem over triangles."""
    vol = 0.0
    for a, b, c in faces:
        ax, ay, az = vertices[a]
        bx, by, bz = vertices[b]
        cx, cy, cz = vertices[c]
        vol += (
            ax * (by * cz - bz * cy)
            - ay * (bx * cz - bz * cx)
            + az * (bx * cy - by * cx)
        )
    return abs(vol) / 6.0


def waist_radius(posed: list, boundary_index: int) -> float:
    """Minimum envelope radius between chamber boundary_index and its successor."""
    axials = [0.0]
    for i in range(1, len(posed)):
        axials.append(axials[-1] + math.dist(posed[i - 1].center, posed[i].center))
    lo = axials[boundary_index]
    hi = axials[boundary_index + 1]
    return min(
        _envelope_radius(posed, lo + (hi - lo) * k / 64.0, axials) for k in range(65)
    )


def _fmt(x: float) -> str:
    return f"{x:.6f}"


def write_obj(vertices: list, faces: list) -> str:
    lines = ["# kaminos hydrostat carrier mesh"]
    for v in vertices:
        lines.append(f"v {_fmt(v[0])} {_fmt(v[1])} {_fmt(v[2])}")
    for f in faces:
        lines.append(f"f {f[0] + 1} {f[1] + 1} {f[2] + 1}")
    return "\n".join(lines) + "\n"


def posed_payload(carrier: Carrier, posed: list) -> dict:
    return {
        "contract": "kaminos.hydrostat-carrier.v0",
        "name": carrier.name,
        "total_rest_volume": sum(c.rest_volume for c in carrier.chambers),
        "total_posed_volume": sum(pc.volume for pc in posed),
        "chambers": [
            {
                "index": pc.index,
                "volume": pc.volume,
                "turgor": pc.turgor,
                "semi_length": pc.semi_length,
                "radius": pc.radius,
                "eccentricity": pc.eccentricity,
                "contact": pc.contact,
                "center": [pc.center[0], pc.center[1], pc.center[2]],
                "tangent": [pc.tangent[0], pc.tangent[1], pc.tangent[2]],
            }
            for pc in posed
        ],
    }


def compile_to_dir(spec_path: Path, out_dir: Path) -> dict:
    """CLI entry: spec JSON in, posed JSON + OBJ + receipt out. On any failure
    a report.json naming the phase is still written."""
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {"contract": "kaminos.hydrostat-carrier.v0", "phase": "load"}
    try:
        raw = json.loads(spec_path.read_text())
        spec_sha = hashlib.sha256(spec_path.read_bytes()).hexdigest()
        carrier = load_spec(raw)
        report["phase"] = "pose"
        posed = pose_carrier(carrier)
        report["phase"] = "mesh"
        vertices, faces = generate_mesh(posed)
        obj_text = write_obj(vertices, faces)
        report["phase"] = "write"
        posed_json = json.dumps(posed_payload(carrier, posed), indent=2, sort_keys=True)
        (out_dir / "posed.json").write_text(posed_json + "\n")
        (out_dir / "mesh.obj").write_text(obj_text)
        receipt = {
            "contract": "kaminos.hydrostat-carrier.v0",
            "spec_path": str(spec_path),
            "spec_sha256": spec_sha,
            "outputs": {
                "posed.json": hashlib.sha256((posed_json + "\n").encode()).hexdigest(),
                "mesh.obj": hashlib.sha256(obj_text.encode()).hexdigest(),
            },
            "mesh_volume": mesh_volume(vertices, faces),
            "vertex_count": len(vertices),
            "face_count": len(faces),
        }
        (out_dir / "receipt.json").write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n"
        )
        return receipt
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
        (out_dir / "report.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n"
        )
        raise


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    comp = sub.add_parser("compile", help="compile a carrier spec to posed JSON + OBJ")
    comp.add_argument("--spec", required=True, type=Path)
    comp.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        receipt = compile_to_dir(args.spec, args.out_dir)
    except SpecError as exc:
        print(f"spec error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # report already written by compile_to_dir
        print(f"failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
