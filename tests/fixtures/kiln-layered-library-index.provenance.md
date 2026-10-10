# Shared Basin Index Fixture

Projection of an observed response, not a synthetic storage contract. Captured with curl from
http://127.0.0.1:8218/api/volume-settings-presets during Wake's October9 layered
cue authoring loop. Effective server source is main9ba6ed54 plus ported
cinema3b7545be and cuese0c7dfc7; serve.py is unchanged from main.
Local store ~/.local/state/kaminos/wake-layered-cues-1009/basins; shared-library
route points to an isolated snapshot of ~/.local/share/kaminos/basins at
~/.local/state/kaminos/wake-layered-cues-1009/library-snapshot.

The response supplies121 current entries and45 earlier versions. This fixture
tests cue-picker consumption of the observed top-level earlierVersions contract;
it does not claim today's live library inventory is fixed or complete.

The public fixture retains every presetId and label in both arrays, omitting
unconsumed runtime/source metadata. The complete original response remains at
~/.local/state/kaminos/wake-layered-cues-1009/evidence/library-index.json.
No entry sampling or ID substitution is performed.
