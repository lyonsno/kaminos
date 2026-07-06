# World Cartridge First-Use Workflow

This is the agent-facing entry path for using a Kaminos world cartridge without a private route explanation from Minion.

Start at `/api/world-cartridges` and choose one cartridge. For the current LERMS worked example, choose `lerms-terrarium`.

Then follow the cartridge's `firstUseTrial`:

1. Enter the cartridge through the API or `worlds/<cartridge-id>/world.json`.
2. Choose one crucible.
3. Name the armature you are mounting.
4. Name the handle you are using.
5. Run one firing.
6. Emit a shard, cast, receipt, smoke-apparition route, graduation report, or gap report.
7. Answer the graduation question.

Each crucible carries `consumerCanStartBy`, `armatures`, `handles`, `firings`, allowed output memory, ownership fields, and any API-visible `smokeOffers`. A `smokeOffers` entry is a route into the Kaminos Smoke Workbench or Forge Host surface for that crucible. Its `authority`, `freshness`, `outputClass`, and `downgrades` define what the route is allowed to prove.

When a smoke offer has a `smokeWorkbench` card, use its `operatorRoute` as the
Kaminos entry point. The card names the Forge Host route kind, the receipt
schema, and the operator steps: open the route, inspect the inline chamber,
capture a smoke receipt, then return the source-owned firing or gap report.

For `lerms-terrarium/glove-emitter`, the first offer is a gap-report route, not passing visual smoke. It gives consumers and the operator a discoverable Kaminos route for the Glove Well/native-host work while preserving the current waiting/stale downgrades.

The broader cartridge ontology and scaffold are documented in [World Cartridges](world-cartridges.md).
