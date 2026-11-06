# Fire lighting budgets

The simulation, light-producing emission, attenuation, incident-light receivers and solid visibility have separate resolutions. Source count is an independent approximation of the emission distribution. Reducing emission resolution keeps all requested sources.

The Scene lighting inspector's **Lighting emission resolution** is the number of source cells across Fine. Height follows the authored box. The default is32 for compatibility;16 gives one eighth as many input cells at the same aspect. Every source cell evaluates eight material samples. This input supplies distributed transport, the spatial reduction into retained surface lights, and raw smoke-shadow extinction; it does not change the visible material or fluid grid. The existing smoke-shadow density grid can independently prepare a smoother extinction field.

Changes replace only the lighting source textures and use the existing runtime grid-shape uniforms. They do not require recompiling the fluid shader. The next preparation rebinds the new source, updates all light regions and fully initializes solid cubes whose centroids may have changed. Normal scene history and saved lighting routes retain the requested resolution. The previous default stays in older scenes.

Positive integer values are admitted up to actual device texture/dispatch capacity. The current source representation uses cubic cells, so the requested width must also give a whole-number height at the authored aspect. Invalid values report that reason; they do not silently round or change the box extent. This is an implementation representation constraint, not a physical law.

## Other hidden choices in the current lighting path

| Choice | Current value or coupling | Role and next treatment |
| --- | --- | --- |
| World incident receiver grid | Nominal8 across World width, aspect aligned | Genuine quality/cost setting. Full World coverage exists; this controls its spatial detail. Expose independently of local refinement. |
| World incident directions | Inherits Fine directions | Genuine quality/cost setting. It should be independently selectable. |
| Exterior extinction integration spacing | World width/8, finer interval for a physical Middle region | Genuine quality/cost setting. Currently coupled to the World receiver-grid constructor argument; separate before offering either as an independent control. |
| Fine and exterior lighting reconstruction |4× per axis | Genuine quality/cost setting. This prepares interpolation samples, not additional independent lighting rays. Fine has a route parameter; exterior is fixed. |
| Fine light integration spacing | One source-cell width | Genuine quality/cost setting currently tied to emission resolution. Lower emission resolution also reduces these ray steps. |
| Emission material quadrature | Eight subcell evaluations | Genuine quality/cost setting. Reducing it is another approximation; no public control yet. |
| Spatial partition stabilization |15% axis preference and0.75cell split hysteresis | Grouping-motion policy. It is not an energy or visibility invariant. Expose if experimentation with source stability needs it. |
| Spatial reduction scheduling |16shards,64threads | GPU scheduling choices. Profile as implementation parameters rather than presenting as scene artistic controls. |
| Importance-pattern exploration |25%, with a2×direction bank | Estimator policy with memory/work consequences when that optional pattern is selected. The baseline blue-noise path does not pay for that proposal bank. |
| Legacy internal emissive field |32wide, six-direction sweep | Separate fallback route from the hybrid source input. The new emission-resolution control does not claim to resize it. |

Near/local refinement bounds, resolution and directions already have controls. The existing inspector also exposes source count, receiver evaluation budget, cube capture budget, cube resolution, blocker/filter samples, smoke-shadow steps/angular resolution/filter width/filter taps/density resolution, sampling pattern and source softness.

Actual device capacity, same-frame resource identity, complete cube initialization, normalized overlap and derivative uniformity are correctness requirements. They are distinct from the quality defaults above.

## Cost interpretation

The source partition has a fixed binary topology for a chosen source count. GPU scans update region moments, axes and split coordinates; it is not a new scene-geometry BVH build each frame. Source resolution reduces work inside those scans and the material seed. The number of tree levels and dispatch overhead remain, so an8×cell reduction is not an8×whole-frame speed claim.

Receiver selection divergence is a separate cost. A source texture array helps small evaluation budgets but can regress all-source evaluation. Cube storage itself is small at64–128px; refreshing a cube still rasterizes six views of the caster geometry. Controls and evidence must distinguish resident count, captures per frame and evaluations per pixel.
