# xatlas 0.0.11 for the browser

`xatlas-0.0.11.wasm` and `xatlas-0.0.11.mjs` are xatlas (Jonathan Young, MIT, `LICENSE`) as bundled in the PyPI `xatlas==0.0.11` sdist (SHA-256 `72f0bc6c42c19252be87e947d9dfe251c8d6c6943fd43e3d173ddc6b1afad693`), compiled with `xatlas-wasm.cpp` to a single-threaded Wasm ES module. The C ABI runs the same call as the TRELLIS2MLX finisher's `uv_unwrap`: one mesh, `ChartOptions{maxIterations=0, fixWinding=false}`, default `PackOptions`, UVs divided by the atlas size as xatlas-python does.

Build (Emscripten 6.0.12, `5488e0871d46d19a3209988190fa6a653126256f`):

```sh
emcc -O3 -DNDEBUG -DXA_MULTITHREADED=0 -std=c++17 -I<sdist>/extern/xatlas/source/xatlas \
  xatlas-wasm.cpp <sdist>/extern/xatlas/source/xatlas/xatlas.cpp -o xatlas-0.0.11.mjs \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS=_xa_unwrap,_xa_charts,_xa_width,_xa_height,_xa_index_count,_xa_read,_xa_release,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU32 -sSTACK_SIZE=8MB
```

xatlas's chart output is sensitive to compiler floating-point codegen: native builds of this exact source with Apple clang 17 (with and without FP contraction) and the published arm64 wheel all produce slightly different atlases from the same mesh. This build is deterministic (identical output across runs and engines, since Wasm floating point is deterministic), and single-threaded output equals the threaded native build of the same compiler. It is the same algorithm and options as the source finisher, not a byte-identical atlas.
