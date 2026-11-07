# Fire lighting budgets

The simulation, light-producing emission, attenuation, incident-light receivers and solid visibility have separate resolutions. Source count is an independent approximation of the emission distribution. Reducing emission resolution keeps all requested sources.

The Scene lighting inspector's **Lighting emission resolution** is the number of source cells across Fine. Height follows the authored box. The default is32 for compatibility;16 gives one eighth as many input cells at the same aspect. Every source cell evaluates eight material samples. This input supplies distributed transport, the spatial reduction into retained surface lights, and raw smoke-shadow extinction; it does not change the visible material or fluid grid. The existing smoke-shadow density grid can independently prepare a smoother extinction field.

Changes replace only the lighting source textures and use the existing runtime grid-shape uniforms. They do not require recompiling the fluid shader. The next preparation rebinds the new source, updates all light regions and fully initializes solid cubes whose centroids may have changed. Normal scene history and saved lighting routes retain the requested resolution. The previous default stays in older scenes.

Positive integer values are admitted up to actual device texture/dispatch capacity. The current source representation uses cubic cells, so the requested width must also give a whole-number height at the authored aspect. Invalid values report that reason; they do not silently round or change the box extent. This is an implementation representation constraint, not a physical law.

## Independent transport controls

| Choice | Current value or coupling | Role and next treatment |
| --- | --- | --- |
| World incident receiver grid | Default8 across World width, aspect aligned | **World smoke light receiver width** controls full World spatial detail independently of Fine and local receivers. |
| World incident directions | Default0 inherits Fine directions | **World light directions** selects an independent even count; local refinement keeps its own count. |
| Exterior integration spacing | Default8 samples across each exterior region width | **Exterior march samples across width** controls physical emission/extinction integration independently of receiver width. |
| Fine and exterior lighting reconstruction | Default4× per axis | **Fine / Exterior light reconstruction per axis** independently prepare interpolation samples; these do not add independent lighting directions. Existing Fine route settings remain compatible. |
| Fine light integration spacing | Default0 follows source-cell width | **Fine march samples across width** decouples the sphere-pattern midpoint step budget from emission resolution. Source-directed patterns retain exact cell traversal. |
| Emission material quadrature | Eight subcell evaluations | Source-construction quality/cost policy; still not exposed. Reducing it changes the material-to-light approximation. |
| Spatial partition stabilization |15% axis preference and0.75cell split hysteresis | Grouping-motion policy. It is not an energy or visibility invariant. Expose if experimentation with source stability needs it. |
| Spatial reduction scheduling |16shards,64threads | GPU scheduling choices. Profile as implementation parameters rather than presenting as scene artistic controls. |
| Importance-pattern exploration |25%, with a2×direction bank | Estimator policy with memory/work consequences when that optional pattern is selected. The baseline blue-noise path does not pay for that proposal bank. |
| Legacy internal emissive field |32wide, six-direction sweep | Separate fallback route from the hybrid source input. The new emission-resolution control does not claim to resize it. |

Near/local refinement bounds, resolution and directions already have controls. The existing inspector also exposes source count, receiver evaluation budget, cube capture budget, cube resolution, blocker/filter samples, smoke-shadow steps/angular resolution/filter width/filter taps/density resolution, sampling pattern and source softness.

Actual device capacity, same-frame resource identity, complete cube initialization, normalized overlap and derivative uniformity are correctness requirements. They are distinct from the quality defaults above.

## Cost interpretation

The source partition has a fixed binary topology for a chosen source count. GPU scans update region moments, axes and split coordinates; it is not a new scene-geometry BVH build each frame. Source resolution reduces work inside those scans and the material seed. The number of tree levels and dispatch overhead remain, so an8×cell reduction is not an8×whole-frame speed claim.

Receiver selection divergence is a separate cost. A source texture array helps small evaluation budgets but can regress all-source evaluation. Cube storage itself is small at64–128px; refreshing a cube still rasterizes six views of the caster geometry. Controls and evidence must distinguish resident count, captures per frame and evaluations per pixel.

## Physical coverage

Distributed incident light has a Fine receiver grid, a coarse receiver grid over the entire active World volume, and optional bounded receiver refinement around Fine. These represent receivers. Every one integrates Fine, Middle and World emission using the physical material law. The Fine source already contains the camera handoff blend; outer transport excludes that interval and blends Middle against World outside it. Retained surface sources reduce the same physical domain, excluding duplicate overlapping representations. Solid captures cover the union of Fine and World; radial smoke shadows include both regions. World emissivity off suppresses exterior emission while retaining its extinction.

**Skip empty lighting space** builds conservative Fine optical support from every nonzero emission or positive extinction cell. It preserves the original midpoint sampling lattice and exact cell traversal. It adds a full source-grid bounds pass per gather; sparse paths may save reads, while dense fields can gain little. A separate bound is used for the second surface-scattering integral. Disable the control to compare that overhead. This is a bounded support optimization, not hierarchical empty-brick traversal.

**Smoke-shadow visibility cutoff** defaults to zero, preserving complete integration. A positive cutoff stops density reads after transmission is sufficiently small and fills all remaining radial prefix entries, including padding. The approximation bounds absolute visibility difference, not the resulting brightness from arbitrarily intense occluded emitters. Full integration remains available.

At fixed physical coverage, receiver work grows with receiver cells times directions times integration samples. Cubic receiver width multiplies cells on all three axes; reconstruction adds a separate receiver-cells times reconstruction-factor cubed preparation. These are lighting-grid rays, separate from camera pixels and camera ray steps. Tuning one budget does not silently alter the others.

The exposed Lighting emission resolution currently controls the Fine source. Exterior source textures follow their material grids; independent exterior emission resolution remains a tuning control to expose. Full World receiver width and directions, integration spacing and reconstruction refinement now have independent inspector controls, normal history, and scene-route persistence. The remaining source construction, grouping and importance proposal policies are listed explicitly above; exposing transport budgets does not claim those policies were tuned. Coverage does not imply that these choices are tuned or affordable in every scene.
