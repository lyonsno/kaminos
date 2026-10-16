# fast-simplification 0.2.0 for the browser

`fast-simplification-0.2.0.wasm` and `fast-simplification-0.2.0.mjs` are the quadric simplifier of the PyPI `fast-simplification==0.2.0` wheel (PyVista developers, MIT, `LICENSE`; after Sven Forstmann's Fast-Quadric-Mesh-Simplification, MIT). They are the same `Simplify.h` (SHA-256 `bcab832a71cfa305b5a3a92bba31ff8008b3b1c0c0ca03dd217ff20bb5fff2bb`) that the TRELLIS2MLX finisher calls through `fast_simplification.simplify`, compiled with `simplify-wasm.cpp` to a single-threaded Wasm ES module.

The native arm64 build contracts a fixed set of multiply-adds into fused multiply-adds (`det`, `vertex_error`, `dot`, `cross`, `length`/`normalize`). `patch.py` writes those same sites as explicit fused multiply-adds through relaxed SIMD (`f64x2.relaxed_madd`), and the module is compiled with `-ffp-contract=off` so nothing else fuses. It also drops the collapse history (never read by the finisher) and reports each iteration to `Module.onIteration`. Where the engine executes `relaxed_madd` as a true fused multiply-add, the output equals the native wheel byte for byte (checked on the browser finishing fixtures and on 300,000 faces of a TRELLIS grass surface). `wasm-simplify.js` probes that before use and otherwise keeps the JS port.

Build (Emscripten 6.0.12, `5488e0871d46d19a3209988190fa6a653126256f`):

```sh
python3 patch.py <wheel>/fast_simplification/Simplify.h Simplify.h
em++ -O3 -DNDEBUG -ffp-contract=off -msimd128 -mrelaxed-simd -std=c++17 simplify-wasm.cpp -I. \
  -o fast-simplification-0.2.0.mjs -sMODULARIZE=1 -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB \
  -sENVIRONMENT=web,worker,node -sEXPORTED_FUNCTIONS=_fs_simplify,_fs_points,_fs_read,_fs_release,_malloc,_free \
  -sINITIAL_MEMORY=64MB -sEXPORTED_RUNTIME_METHODS=HEAPF64,HEAP32
```
