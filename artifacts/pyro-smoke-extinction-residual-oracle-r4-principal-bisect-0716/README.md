# Smoke Residual Oracle R4 - Local Principal Bisection

R4 tests whether R1-R3 lose topology because one Gaussian cannot represent multiple coherent residual modes inside a rigid 4x4x4 neighborhood. It retains one complete rigid partition and bisects each geometrically splittable parent at a residual-mass weighted median between distinct full-covariance principal-axis projection buckets.

## Controlled Change

- Exact R160 step 45 pre-absorption physical body target, frozen 1,024 control, source sidecar, cameras, extinction scale `0.2`, coverage `1`, and display exposure `8x` remain fixed.
- 49,393 / 49,536 positive parents split; 143 parents remain unsplit because their top covariance eigenspace is degenerate under the explicit relative-gap authority gate.
- Natural R4 count: 98,929 residual / 99,953 combined, no cap. This is count-matched to R3's 100,215 residual rows.
- Every source voxel belongs to the single rigid partition exactly once; child rows partition parent mass without duplicating voxel membership. Membership range is `[1,1]`.
- Principal-axis authority requires `(lambda0 - lambda1) / lambda0 > 1e-4`. The minimum accepted relative eigenvalue gap is `4.442545236e-4`; 143 degenerate parents were refused. Minimum legal voxel projection gap among accepted splits is `5.877120984e-9`; no tied projection boundaries were selected.
- Residual product: `sha256:250fe4a588b0f479c3316b4b88f78b2f95e7525ec2faf91de86cd301f7e408df`.
- Combined product: `sha256:3cb0fda52f5c8c32de9a5c817bed8ebc69817810f287c07b5aa8afb7fc503312`.
- Combined relative error before serialization: `1.9295013e-10`.

## Result

| Camera | R2 MSE | R3 MSE | R4 MSE | R4 vs R2 | R4 vs R3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| recorded native | `1.0404400e-6` | `9.7136929e-7` | `1.0758002e-6` | `+3.40%` | `+10.75%` |
| elevated +35 held out | `2.7985763e-6` | `2.7914911e-6` | `2.7881062e-6` | `-0.37%` | `-0.12%` |

The inspected R4 native panel reasserts/sharpens the same horizontal stack and centered column. It does not recover the exact target's lateral tongue, cavities, or self-occluding interior sheets. Elevated is effectively unchanged. Count-matched local principal bisection therefore loses to overlap in native error and supplies no compensating topology.

Fresh review found that the initial implementation could label an arbitrary basis axis as principal when the top eigenvalues tied. A symmetric-square fail-first fixture now requires such parents to remain unsplit. On the exact basin, all 143 already-unsplit parents are the degenerate set and every emitted split clears the new authority threshold, so product hashes, pixels, counts, and metrics remain unchanged; regenerated reports now expose the authority diagnostics.

## Inspect

[`witness/contextual-comparison/index.html`](witness/contextual-comparison/index.html) anchors exact target, R2 rigid full covariance, R3 count-matched overlap, R4 local principal bisection, and R4 target-error roles at native and elevated +35. [`native-elevated-exposure8x.png`](witness/contextual-comparison/native-elevated-exposure8x.png), `sha256:61c231962148f995b493538c3b8d861e6912b6d9894edcee54c605125c9efd7e`, is the directly inspected final record.

One initial CDP capture reached a different pre-existing server on a colliding port and returned an error page with zero images. It was rejected. The final job used a verified unique server route and required exact page title, `readyState=complete`, exactly ten complete `640x455` images, and body height above 900 pixels before capture. This guards wrong-route, partial, and blank evidence.

## Disposition

Full within-block covariance, staggered cross-block overlap, and count-matched local principal bisection have all failed to recover topology. Do not tune cuts, add split depth, or create another independent Gaussian moment partition. The exact physical support carrier remains strong, but local moment compression erases the structure needed for tall articulated smoke. The next route must preserve connected local-grid occupancy/sheet state through a calibrated learned classifier or a connected sparse-volume substrate before any temporal predictor or production budget claim.
