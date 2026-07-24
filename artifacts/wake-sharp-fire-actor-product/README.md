# Wake SHARP FireActor Product Firing

Status: explicitly stopped product stall; no terminal product acceptance
claimed.

The sole released firing ran uncontended from reviewed Kaminos consumer
`3e018a00c9ba788714ca83d446791a1e24feff8f` against exact SHARP
`637f45fe4150e34a36fd2200f08319a964bdbaee`. It wrote beginning and middle
captures 16 seconds apart, showing the promoted FireActor alive while SHARP
advanced from 28% to 46%. It then produced no end, terminal, PLY, or canonical
report progress for roughly 26 minutes despite continued Chrome CPU activity.
Integration explicitly authorized stopping only the exact witness and Chrome
processes. No automatic rerun is authorized.

Last trustworthy state:

- phase: `middle-captured/awaiting-end-or-terminal`
- beginning: `live/beginning.png`, 1,000,258 bytes, SHA-256
  `419ada251daac77bd4a88eeee62186e6b859c84b708548986fa5a2ea62093d0f`
- middle: `live/middle.png`, 1,473,594 bytes, SHA-256
  `835a513b7bef5023e4092150c981d6df66b09c7b6dd5987b9d613547bc5deeb9`
- missing: `live/end.png`, `live/terminal.png`, and PLY output
- Chrome CPU advanced from `6:35.58` to `6:38.53` over the bounded liveness
  observation while the canonical output phase did not advance.
- mount:
  `firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7`
- actor: `wake-kiln-flamebowl-hero`
- basin revision:
  `basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95`
- package SHA-256:
  `f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc`
- carrier: `kaminos.wake-sharp-promoted-fire-volume-adapter.v1`, SHA-256
  `9654565c662782d22a3d2d3917cbec139715eeafccff3c1b4050d6f80797ba6d`
- no browser probe, fallback, runtime exception, or competing GPU work was
  observed after the stall.

Canonical stall report:

- `live/report.json`
- SHA-256:
  `fc8a946b809c2fb2469fa32141d369cccb0f4d6865841f0d18c0e24354a95d4d`
- `ok: false`
- `status: stopped-explicit-product-stall`
- `phase: middle-captured/awaiting-end-or-terminal`
- `primaryOutputWritten: false`

The images prove real beginning-to-middle composition and expose the current
beauty problem: the actor is oversized and strongly clipped by exposure. They
do not prove route completion, coherent PLY, or terminal presentation. The
prior `firing-mryh01td-fqsvu6` report was stale during this firing; its exact
identity is retained inside the replacement report rather than presented as
current evidence.
