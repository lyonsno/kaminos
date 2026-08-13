# Reference CUDA TRELLIS route adjudication

This assay asks whether the weak rigid-stone TRELLIS reconstruction is model behavior or a pathology of the current Mac routes. It uses the exact FLUX source previously compared through `trellis2mlx_fast` and Stable Fast 3D, plus the canonical Microsoft `T.png` positive control.

## Current result

The official Microsoft CUDA Space produced a healthy, richly structured GLB for the canonical control at the deployed 1024 defaults. That clears stock-route health.

The exact rigid-stone source then completed official CUDA inference and returned the Space's 48-view preview in 30.75 seconds during the anonymous public run. The separate GLB extraction call was rejected by the public Space's ZeroGPU quota. The preview was not retained by the first runner; the runner now preserves it on replay. A later authenticated same-source retry was rejected before inference and returned no preview. It is a separate quota-admission failure, not a counter-result. Neither attempt produced a usable stone reconstruction.

The exact paid replay is prepared against the official Space image, pinned app and model revisions, exact preprocessed source, A10G 24 GB, seed 80301, official sampler defaults, 300,000-face remeshed export, and 2K texture. The 15-minute compute ceiling is $0.2505. The Hugging Face MCP route required reauthentication; the authenticated first-party CLI reached the service but was rejected before provisioning because the account has no positive prepaid balance. No paid job ran and no charge occurred.

The private replay substrate is `lyonsno/kaminos-private-cuda-receipts`. The source and runner live under `reference-cuda-trellis/stone-seed80301-res1024/`; source upload commit `cc8ec94277cfc390c52d72787322afe3d55a6456`, runner upload commit `9754162c7f2fde9f51cc0a1650d2d3763362d11e`. Once the job has valid result persistence credentials, the runner writes each phase-bearing report locally, emits the full report into the job log, then uploads it. Hub transport failure can still prevent remote persistence; the emitted job log remains the recovery surface.

`evidence-sheet.html` puts the exact source, official CUDA control, hash-bound vendored MLX and SF3D stone orbits, both public-Space stone attempts, unresolved CUDA stone state, and continuation economics on one visual surface. `run_official_space.py` is the replayable public-Space route. `reference_cuda_job.py` is the pinned paid-job route. Their focused tests cover stale-output false closure, attempt chronology, comparison-frame drift, local report emission, and pre-provisioning failure semantics.

## Campaign meaning

The current evidence rejects a global `TRELLIS > SF3D` ordering. SF3D is a real source-fidelity counter-route; TRELLIS often has stronger hidden-side completion and sharper geometry, but can normalize a source into a learned basin. Official CUDA remains a material unresolved discriminator because the Mac routes have produced degenerate outputs on sources that stock CUDA is known to reconstruct well.

Claim ceiling: official CUDA route health and exact-stone model-return evidence only. The disputed source has no official CUDA geometry verdict until its GLB is exported and visually inspected.
