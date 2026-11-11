# Shared particle lighting: opposite-direction experiment

`volume-particle-light-sweep.mjs` consumes the existing 96-byte current-composition carrier buffer. It does not advance chemistry, change particles, replace the camera renderer, or enable lighting by default. This is a computational transport experiment on an explicitly named particle fixture stack.

Each carrier contributes intrinsic emission and soot extinction. Captured scattered illumination is excluded. The provisional 3D reconstruction is a normalized anisotropic Gaussian, with coefficient volume weighted by birth pitch squared times represented ray length. Radius, stretch, expansion, flow alignment, lifetime fade and optical gains are explicit inputs. This convention is not proof of unbiased density or visual equivalence to existing camera splats. The camera's non-Gaussian profile, screen-pixel floor and footprint cap are not silently treated as 3D material properties.

The direction and an orthonormal transverse basis define coordinates relative to an explicit world origin. Extents are in that basis. Rasterization writes RGB emission integrals and optical depth into a slab atlas. A Gaussian conditional depth CDF distributes support through all slabs rather than placing the entire particle in its center slice. The projected ellipse has an explicit sigma cutoff. Optional transverse cell-footprint filtering adds the second moment of a box footprint to covariance; its width is an input, independent of receiver count.

Each column is swept in both directions during the current submission. At a receiver center, half the local slab precedes the sample. A slab transfer is `outgoing = localEmission + transmission * incoming`; local emission uses the homogeneous-medium exponential integral. Every receiver retains radiance RGB and boundary transmission. An opaque-cell mask resets upstream illumination; emitters after an opaque cell still illuminate that next region. The caller supplies this mask. Real-scene geometry voxelization is not implemented here.

The atlas uses additive RGBA16F. Extremely bright/overlapping deposits can exceed its finite range; the witness rejects nonfinite fields. Dynamic range and deposition precision must be assessed before product adoption. No native HDR-equivalence or production overflow policy is claimed.

`tools/particle-light-witness.mjs` replays a complete captured native carrier population after checking effective route, current composition, revision, digest, byte length and nonblank source. It writes a terminal report on success or failure, retains source bytes and metadata, preserves every deposited/output value, and compares all interior receivers against independent repeated ray integration through that deposited medium. This reference establishes the sweep, not the fidelity of a coarse slab reconstruction to continuous Gaussian transport.

Run the small production-kernel checks with:

```sh
npm test -- --only tests/volume-particle-light-sweep.mjs,tests/particle-light-witness.mjs
```

The larger captured-population witness belongs in Greenroom. Its positional inputs are snapshot JSON, native capture report, expected source revision, and caller-owned output directory. Source capture may precede the lighting implementation revision; both identities are retained separately. No FPS or full-scene benefit follows from a two-direction correctness result. The next comparison charges oblique deposition, transport, receiver reconstruction and solid visibility across a useful angular set.
