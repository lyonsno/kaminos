# Wake SHARP FireActor Product Firing

Status: historical failed witness run against obsolete SHARP `637f45f`; retained
as failure evidence only. It is not current product authority and claims no
FireActor defect or product acceptance.

The exact renewed firing `firing-mryh01td-fqsvu6` ran uncontended from
`2026-07-24T04:58:55.110Z` through `2026-07-24T05:05:59.371Z` from Kaminos
consumer checkpoint `7b92871c` against exact SHARP
`637f45fe4150e34a36fd2200f08319a964bdbaee`. The witness failed with
`Runtime.evaluate timed out` before any beginning, middle, end, terminal, or PLY
artifact was produced.

Last trustworthy state:

- SHARP route remained `running` at progress `0.6057449653686278`: patch `6/35`,
  block `10/24`, `norm2 fc1`.
- FireActor episode remained `recording` for the same firing.
- mount:
  `firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7`
- actor: `wake-kiln-flamebowl-hero`
- basin revision:
  `basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95`
- package SHA-256:
  `f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc`
- carrier: `kaminos.wake-sharp-promoted-fire-volume-adapter.v1`
- presentation was admissible with no presentation failures, product-episode
  failures, fallback, or runtime exceptions.
- the settle monitor retained `28,241` samples and reset `334` times because its
  old visual predicate rejected observation gaps over `50ms`.

Canonical failure report:

- `live/report.json`
- SHA-256:
  `6a22a836c57748a93a4bbaba4088bcb85e960672a48343360039ed08fbf784b5`
- `ok: false`
- `primaryOutputWritten: false`

This report does not disprove SHARP, the FireActor, its package, the promoted
carrier, or the shared-device product route. It proves the pre-repair witness
could not observe that route honestly under contention: it coupled visual
authority to a cadence threshold and imposed an implicit `420,000ms` product
deadline.

The fail-first repair removes observation-gap blocking from visual authority
while retaining the gap diagnostic, makes route polling short and recoverable,
advances the report phase immediately after monitor installation, and leaves
the product route uncapped unless the caller explicitly supplies
`--fire-timeout-ms`. No additional expensive firing is authorized by this
artifact.
