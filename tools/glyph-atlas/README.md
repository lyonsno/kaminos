# Kaminos Glyph Atlas

The atlas is a local morphology reservoir for the Kaminos wordmark foundry. It
renders the complete effective corpus as normalized `KAMINOS` words and
addressable `K A M I N O S` glyph plates. Selecting a glyph opens a 1024-square
black-on-white conditioning plate that can be downloaded as PNG.

It is not a font recommendation list, a canonical wordmark selector, or a
license-clearing service.

## Build

```sh
node tools/glyph-atlas/build.mjs \
  --config tools/glyph-atlas/sources.json \
  --out scratch/glyph-atlas \
  --report scratch/glyph-atlas/build-report.json
```

Open `scratch/glyph-atlas/index.html`. The default source uses Fontconfig to
include every installed face that contains all `KAMINOS` codepoints. The build
does not impose a face limit. It emits an uncapped-flow diagnostic when the
population crosses the configured observation threshold.

## Smoke

```sh
node tools/glyph-atlas/smoke.mjs \
  --atlas scratch/glyph-atlas \
  --out scratch/glyph-atlas/smoke.png \
  --report scratch/glyph-atlas/smoke-report.json
```

The smoke loads a deep-linked glyph, verifies the effective file route and
selected export state in the rendered DOM, captures the browser viewport, and
writes a report even if Chrome fails before the screenshot exists.

## Add Sources

Copy `sources.open-fonts.example.json` to a caller-owned config path, point its
directory roots at local checkouts or extracted archives, and record the exact
revision in each source's `ref`. Directory sources are scanned recursively with
`fc-scan`; unsupported codepoint coverage is removed explicitly and reported in
source accounting.

Google Fonts is the breadth source: its repository groups families by license
and retains per-family license files and metadata. Velvetyne is the first
high-yield experimental source: its current catalog is small enough to inspect
and intentionally favors strange libre display work. They are intake
conveniences, not privileged atlas concepts.

`license.status: per-family-license-required` means the atlas may be used for
reference and conditioning research, but selected production material still
requires reading the exact family license and any reserved-name terms.

## Test

```sh
node tests/glyph-atlas-contracts.mjs
```
