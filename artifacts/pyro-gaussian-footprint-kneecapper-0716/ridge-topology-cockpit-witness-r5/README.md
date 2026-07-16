# Ridge Topology Cockpit Witness R5

Question: Is the view-stable Ridge residual primarily missing geometry, or can omitted authored Topology Break plus independent splat radiance/opacity calibration explain the visibly blown-out reconstruction?

Result: The exact Ridge target consumes `reactionBoundaryTopology=0.96` in its `boundary_fire` inspect emission/extinction path, while the world-covariance splat appearance path has no Topology Break input. Baseline splats at radiance/opacity `1.00/1.00` are visibly overexposed. Lowering only splat radiance/opacity to `0.55/0.75` removes much of the blowout while preserving the same ridge cavities, scalloped sheets, and vertical filaments. Desktop and mobile cockpit layouts are unobstructed.

Route:

- Repo/worktree: `/private/tmp/kaminos-pyro-gaussian-footprint-kneecapper-0716`
- Branch/source head: `cc/pyro-gaussian-footprint-kneecapper-0716` from `a624c879`
- Greenroom job: `6a3168632115`, type `kaminos_ridge_topology_cockpit_witness`
- Cockpit: `http://127.0.0.1:18223/ridge-topology-cockpit.html`
- Wrapper/renderer/backend: `exact-basin-selective-head-live-v0` / `native-3d-compute-fluid-raymarch-v0` / `WebGPU:apple`
- Frozen source: grid 160, source frame 96, simulation step 96, controls hash `dd8b25a6fad4775355e539d58d107fc7a26588ac23e7ec123a5d0eb999bb406f`
- Fluid/front anchors: `d58df9b715f0e7cd21b2e97811e5f19b2ecf2e7494a7e2bbc3866f61fcb94ac1` / `1fd70b831b7f377d2923288715ca6ccbe26939790fd51b8f759ffb7c00ff29e8`
- Effective command and per-image SHA-256 hashes: `report.json`

Images:

- `target.png`: exact smoke-off Ridge raymarch target with Topology Break `0.96`.
- `splats-baseline.png`: current world-covariance splats at radiance/opacity `1.00/1.00`.
- `splats-cooled.png`: same state, candidates, covariance, radius, and sharpness at radiance/opacity `0.55/0.75`.
- `mobile-cooled.png`: compact viewport witness of the cooled splats and scrollable controls.

Does not prove: Global radiance/opacity calibration is not a substitute for training an authored-control-conditioned per-splat appearance head. This witness does not quantify the optimal gains over all cameras, add Topology Break to Tiger's trainer, or establish that every remaining residual is appearance rather than support, local covariance, or unmodeled optical layers.
