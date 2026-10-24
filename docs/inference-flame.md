# Author a flame response to ImageGen

Open the **Flame · inference & replay** experiment in Workbench. It uses the scene's existing flame and the ordinary Properties controls.

1. Choose or capture A and B in **Author A/B looks in Properties**. Check the parameters that should travel together. The existing blend slider auditions the endpoints.
2. Choose an inference stage and click **Use current A/B blend**. A stage starts at A; observed progress moves toward B. A stage without measured progress holds A. Unassigned stages keep the current response.
3. Optionally tune a brighter or otherwise different peak in Properties, open **Flare when a preview appears**, and capture it. The checked parameters move toward that peak when a preview arrives, then settle back onto the continuing stage response.
4. Press **Replay** or scrub the recording. Replay reconstructs the parameter response; the fluid continues evolving. Pause keeps the current look. A replay preview is one scene history edit.
5. Click **Follow next ImageGen**, then use the normal **Generate** panel. The next run supplies real stage, step and preview events. **Use latest ImageGen run** loads its observations for replay afterward.

The initial recording is an illustrated demo, labelled as such. Klein's real intermediate previews are approximate latent RGB projections, not fully decoded intermediate images. Stages without known progress show no percentage.

**Save arrangement** writes the recording, its preview pixels, stage looks and flare to one JSON file. **Open arrangement** restores that file. File export is how to retain recordings across page sessions; the in-page event store is temporary. Preview computation is requested only when Follow is armed at generation admission. Pausing Follow stops observing previews; a pipeline that already received the preview callback can still perform its remaining preview work until that generation ends.

For agent use, the same operations are available through `window.kaminosWorkbenchExperiments.invoke`: `response.assign`, `response.captureFlare`, `response.play`, `response.seek`, `response.pause`, `response.follow`, `response.export`, and `response.restore`. An experiment can open with `{arrangement, blend}` inputs, or `{arrangementUrl}` pointing to a saved JSON arrangement. The URL form fetches the exact file and reports failure rather than silently using the demo. Opening an arrangement does not automatically apply its looks; Replay or seeking applies them.
