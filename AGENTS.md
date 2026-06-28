# Kaminos Agent Notes

## Operator Handles

### `cliplet sheet`

When the operator says `cliplet sheet`, resolve it to the Motion panel's selected-cliplet contact sheet export.

- Human UI: Kaminos Motion panel -> Export controls -> `Cliplet Sheet`.
- Meaning: export a contact sheet for the currently selected generated motion cliplet from the current take, without regenerating motion.
- Runtime API: `window.exportMotionPanelSelectedClipletFilmstrip()`.
- Live witness: `node motion-panel-live-witness.mjs --export-selected-cliplet ...`.
- Implementation commit: `3d35766` (`Export selected motion cliplet contact sheets`).

Do not ask the operator for a path when they say this phrase. Search this repo for `cliplet sheet`, then use the UI/API/witness pointers above.
