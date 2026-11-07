# Fire lighting budgets

The simulation, light-producing emission, attenuation, incident-light receivers and solid visibility have separate resolutions. Source count is an independent approximation of the emission distribution. Reducing emission resolution keeps all requested sources.

The Scene lighting inspector's **Lighting emission resolution** is the number of source cells across Fine. Height follows the authored box. The default is32 for compatibility;16 gives one eighth as many input cells at the same aspect. Every source cell evaluates eight material samples by default. **Fine emission material samples per axis** selects a cubic subcell lattice:1uses the center,2uses8samples,3uses27. It is a live source uniform, separate from source-grid width and camera material. This input supplies distributed transport, the spatial reduction into retained surface lights, and raw smoke-shadow extinction; it does not change the visible material or fluid grid. The existing smoke-shadow density grid can independently prepare a smoother extinction field.

Changes replace only the lighting source textures and use the existing runtime grid-shape uniforms. They do not require recompiling the fluid shader. The next preparation rebinds the new source, updates all light regions and fully initializes solid cubes whose centroids may have changed. Normal scene history and saved lighting routes retain the requested resolution. The previous default stays in older scenes.

Accepted lighting setting requests enter undo history immediately. Shader preparation remains pending separately, with the accepted old scene still drawable. Further setting requests and unrelated gestures need not wait for compilation to release a scene-history transaction. Undo restores the requested setting and waits for its replacement lighting; a failed preparation leaves its requested value undoable. Asynchronous caster-asset replacement retains its existing settled-edit transaction.

The material-sampling field previews its cubic work from the live source dimensions before a draft value is committed. At16×32×16 cells,10samples per axis means1,000samples per cell and8,192,000material evaluations per lighting update,125times the default2-per-axis work. These are analytical counts, not elapsed-time measurements or an imposed quality limit.

Positive integer values are admitted up to actual device texture/dispatch capacity. The current source representation uses cubic cells, so the requested width must also give a whole-number height at the authored aspect. Invalid values report that reason; they do not silently round or change the box extent. This is an implementation representation constraint, not a physical law.

## Independent transport controls

| Choice | Current value or coupling | Role and next treatment |
| --- | --- | --- |
| World incident receiver grid | Default8 across World width, aspect aligned | **World smoke light receiver width** controls full World spatial detail independently of Fine and local receivers. |
| World incident directions | Default0 inherits Fine directions | **World light directions** selects an independent even count; local refinement keeps its own count. |
| Exterior integration spacing | Default8 samples across each exterior region width | **Exterior march samples across width** controls physical emission/extinction integration independently of receiver width. |
| Fine and exterior lighting reconstruction | Default4× per axis | **Fine / Exterior light reconstruction per axis** independently prepare interpolation samples; these do not add independent lighting directions. Existing Fine route settings remain compatible. |
| Fine light integration spacing | Default0 follows source-cell width | **Fine march samples across width** decouples the sphere-pattern midpoint step budget from emission resolution. Source-directed patterns retain exact cell traversal. |
| Emission material quadrature | Default2samples per axis,8per cell | **Fine emission material samples per axis** exposes this source-construction approximation independently of source-grid width. |
| Spatial partition stabilization | Default15% axis preference and0.75cell split hysteresis | **Source split axis preference** and **Source split hysteresis (cells)** tune retained surface-source grouping stability. They do not add/remove emission energy. |
| Spatial reduction scheduling |16shards,64threads | GPU scheduling choices. Profile as implementation parameters rather than presenting as scene artistic controls. |
| Importance-pattern proposal policy | Default25% exploration,2×direction bank,0.98score decay,0.25new-score blend | The four **Importance** controls expose proposal support, memory/work, and adaptation. Only the Importance pattern uses them. Positive exploration preserves support; a bank too large for the selected fraction’s float32 CDF precision is rejected with that reason. These scores are proposal history, not cached radiance. |
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

The viewport counter labels scene and flame CPU submission cadence separately. A held or paused flame is named explicitly; shared-GPU queue completion latency is shown when available. These rates are not displayed FPS, and queue latency is not isolated GPU frame time.

The exposed Lighting emission resolution currently controls the Fine source. Exterior source textures follow their material grids; independent exterior emission resolution remains a tuning control to expose. Full World receiver width and directions, integration spacing and reconstruction refinement now have independent inspector controls, normal history, and scene-route persistence. Source quadrature, grouping stability and optional importance proposal policy also have inspector controls. Their original defaults are preserved; exposing them does not claim that they were tuned. GPU workgroup/shard scheduling remains an implementation profiling choice, and exterior source texture resolution follows the separately exposed World/Middle material grids. Coverage does not imply that these choices are tuned or affordable in every scene.
