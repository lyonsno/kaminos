# Shader Herder development package

`kaminos-shader-herder-0.1.1.tgz` is the npm archive of `@kaminos/shader-herder` from source commit `f8b7004` in `lyonsno/shader-herder` (private source repository). Kaminos installs the archive through its local file dependency and lockfile; installation does not require access to that repository.

The archive contains `package.json`, `README.md` and `src/index.mjs`, and pins the Dawn `webgpu` binding to `0.6.2`. The lockfile records the archive's SHA-512 integrity. Rebuild from that source revision with `npm ci` and `npm pack`; the resulting archive must match the locked integrity before replacing it. A changed package uses a new version and archive path.

See `docs/testing.md#native-shader-tests` for consumer execution and the distinction between hardware numerical results and compiler-only validation.
