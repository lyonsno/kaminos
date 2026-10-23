# Finite PBF material scaling

Finite authored water and `lazarus/finite-pbf` opt into `materialScaling: 'reference_acceleration'`. Other callers retain the core default `'legacy'`. The reference is h₀ = 0.185 world units, Δt₀ = 1/60 s, n₀ = 3 pressure passes and velocity retention r₀ = 0.991. These identify the retained nominal parameterization; they are not measured physical water properties or a new fit to an image.

The density kernel uses equal-volume particles with fixed h/spacing. Under uniform spatial refinement at the same normalized neighbor coordinates q = r/h, its normalized weight ratio is unchanged and its density-constraint gradient scales as 1/h. The existing repulsion contribution per pressure pass is

    δx_rep = -k Σ_j (W_ij / W_ref)^4 G_ij.

For a frozen local configuration, the acceleration-equivalent effect accumulated over n passes is proportional to n k/(h Δt²). The candidate coefficient is therefore

    k = k₀ strength (Δt/Δt₀)² (h/h₀) (n₀/n),
    k₀ = 0.0012.

The uniform velocity multiplier uses

    r(Δt) = exp(log(r₀) Δt/Δt₀).

Equal physical durations now receive the same uniform drag. The existing nominal-diffusion viscosity rule remains separate and uses Δt/h². A timestep/refinement combination that exceeds its convex mixing limit still fails explicitly.

This is an acceleration reference for the anti-clustering term, not a derivation of physical surface tension or a promise of full solver invariance. Neighbor rearrangement, changing surface support, constraint convergence, correction/speed caps, floating-point order and truncated boundaries remain consequential. Increasing density passes still changes pressure convergence; it no longer intentionally multiplies this term's frozen-configuration acceleration. The PBF paper identifies artificial pressure's surface-tension-like effect as nonphysical and dependent on spatial resolution and timestep: https://mmacklin.com/pbf_sig_preprint.pdf, sections 4 and 9.

`getDebugState().materialScaling` records the mode, actual timestep/support/pass count, reference, coefficient scale, f32 coefficient and drag retention submitted to the GPU. Live changes to repulsion or pass count are recomputed before the next parameter submission. Authored water exposes these effective values in the shared settings inspector. The shader ABI is unchanged: byte84 remains drag retention and byte200 remains the signed positional coefficient.

The legacy mode retains its constant per-step coefficient and multiplier for exact comparisons. The IPBF path retains its own damping and does not admit this finite-PBF mode. Reduced diagnostic dynamics and nonuniform populations are not a supported interpretation of this reference.

Authored finite water exposes **Physics ticks / simulated second** in Shared water settings. Enter 120 for a 1/120-second tick or 240 for 1/240. The saved `localLiquid.simulationStepSeconds` value applies on the next Replay; a running allocation retains its original timestep, shown separately in the inspector. Ordinary Undo/Redo and scene save/reopen preserve the edit. Older scenes without the field retain 1/240. The control follows the existing owner/core contract of 30–240 ticks/s; fine sampling can still reject a longer step through the viscosity mixing guard. Playback speed remains separate.
