# Wake Kiln Flamebowl Preview Mount

This consumer mount pins the current promoted Flamebowl revision for an
inference-independent operator preview at Wake and Bake Pit Boss' existing
Crucible Firing Station. It is a preview heat source, not evidence of a SHARP
firing or generated cast.

The checked-in policy records the initial blockout values selected by the
operator on 2026-07-20. They are consumer policy, not basin identity. Replacing
them must produce a new policy and mount identity while retaining the exact
basin revision until the operator deliberately advances the channel.

Mount schema v1 is deliberately world-up: the consumer anchor supplies a
translation and a uniform scale. Rotation and nonuniform scale fail loud
because the mount contract admits world-up placement only.

Generate or verify the mount from the repository root:

```sh
node volume-fire-actor-mount.mjs mount \
  --channel artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/current.json \
  --handle big-raymarch-hero-flamebowl-cotangent-covariance \
  --revision basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95 \
  --settings-store artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/consumers/wake-kiln-preview/settings \
  --origin http://127.0.0.1:8399 \
  --actor-id wake-kiln-flamebowl-hero \
  --consumer artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/consumers/wake-kiln-preview/consumer.json \
  --transform artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/consumers/wake-kiln-preview/transform.json \
  --policy artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/consumers/wake-kiln-preview/policy.json \
  --out artifacts/basin-promotions/big-raymarch-hero-flamebowl-cotangent-covariance/consumers/wake-kiln-preview/mount.json
```

Port `8399` is the recorded consumer origin; verify the current serving source before opening it. A runtime reseat regenerates the mount's loader URLs;
it does not alter the basin, policy, or mount identity.

The current mount uses the retained reference renderer. Historical splat policy remains in `policy.requested`; `policy.effective.splats.enabled` is false with an explicit retirement reason. The immutable basin package and authoring snapshot keep their original bytes and revision. The mutable mount and policy identities change when their effective renderer changes.
