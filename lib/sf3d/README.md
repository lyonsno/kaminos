# SF3D producer library (vendored build)

Built from `lyonsno/sf3d-webgpu` with `npx vite build -c vite.lib.config.js`
(source commit recorded in `BUILD.txt`). Code only: `sf3d-producer.js` (the
producer with the WebGPU inference kit bundled) and the five worker chunks
under `assets/`. The large assets are served from an SF3D checkout at runtime
and never committed here: `weights.bin` (2.13 GB, SHA-256 `0e5c23c8…`) and
`tets/` (~50 MB tet grid) are symlinked by `../../serve-sf3d-elfinblue.sh`.
