# User preferences

Open **Preferences** in the shared header, or press **Cmd/Ctrl+,**. Change the
new-scene settings directly, or use **Use current scene settings** to start from
the current look and view. **Save preferences** stores the draft without
changing the scene behind the window. **Factory settings** replaces the draft;
it takes effect only after Save. **Open a new scene** opens an ordinary empty
Authoring tab, preserving the current scene.

Defaults include environment and ground, scene lighting/AO/DOF, backdrop,
viewport display, navigation view and output aspect. They contain no objects,
simulation recipes, active camera identity or selection. Navigation is an app
preference and updates immediately on Save. Before explicit scene defaults have
been saved, the existing browser-local startup restoration remains available.
Once saved, the explicit defaults take precedence over last browser-local tweaks.
A saved scene or an explicit asset, fire or experiment address retains its own
startup contract. Saving or editing a scene does not update preferences.

The Python host serves `GET /api/preferences` and `POST /api/preferences`.
Preferences are stored in `~/.config/kaminos/preferences.json`; set
`KAMINOS_PREFERENCES_PATH` to choose another file, including an isolated witness
file. Servers using the same file share preferences across ports. Older hosts
without the endpoint show an unavailable status rather than claim a successful
save. Their existing browser-local settings are not erased.

The document schema is `kaminos.preferences.v1`, with `sceneDefaults` (a
settings object or null) and `navigationInput` (`trackpad`, `mouse`, or null for
platform automatic). Additive fields are retained. The API returns
`{preferences, revision, storePath}`; POST sends `{preferences, revision}` using
the last acknowledged revision. A stale write returns 409 and preserves the
file. Malformed records fail visibly and are never replaced by a default file.
Writes use a shared file lock and atomic replacement.

`window.kaminosPreferences` exposes `open`, `close`, `read`, `load`, `save`,
`capture` and `startup`. Capture returns settings only; it does not save them.
The UI and callers use the same validation and storage operation. Startup
applies settings through the ordinary scene loader before an owner consumer
enters the scene; it skips default reconstruction if editing has already begun.

Preferences has two editing targets: **New scenes** and **Agent runs**. Agent
runs inherit New scenes until **Use new-scene defaults for agents** is unchecked
or **Use current scene settings** authors an agent default. Both targets save in
one revision-protected document; `agentSceneDefaults` is a settings object, or
null to inherit `sceneDefaults`. There is no separate agent profile file.
Navigation and the Studio look library selection remain app-wide preferences.

The lighting section exposes the complete current SSGI state, including
resolution, slices/steps, spatial filtering, temporal refinement, further
bounces, estimator sampling options and depth/normal/brightness filter edges.
**AO strength** controls final receiving occlusion and applies to both lighting
modes. **AO contrast (exponent)** controls SSGI's own visibility exponent;
one preserves the original estimate, and larger values deepen occlusion.
Radius, thickness, slices and steps are shared AO/GI search parameters. The
GTAO-only radius, scale, thickness and falloff appear only when GTAO is selected.
They do not control SSGI. Numeric fields use the ordinary drag-or-type interaction.

**Automatic scene scale** omits SSGI radius and thickness from the selected
settings template, allowing scene calibration to choose them. It is selected
for a new factory template. Capturing the current scene preserves all other
lighting values and retains this scale choice. Turn automatic scale off to
save explicit world-space radius/thickness values. No factory quality defaults
are changed by capturing or saving a template.

Agents opt in with `defaults=agent` on an ordinary empty-scene or Workbench
address. For example:

```text
/?workspace=workbench&defaults=agent&experiment=material-study&experiment_inputs=%7B%22roughness%22%3A0.8%7D
```

This restores the authored agent settings through the ordinary scene loader
before the experiment opens. The experiment then owns any explicit settings
it applies. Ordinary experiment URLs retain their existing startup behavior.
Saved scene, asset, fire and other explicit scene inputs bypass the defaults,
even if `defaults=agent` is present. This avoids replacing an authored scene's
lighting recipe. The Preferences footer offers **Open an agent scene** while
editing Agent runs.

`window.kaminosPreferences.defaults('agent')` returns the selected settings and
inheritance decision without applying them. `startup()` reports `requested`,
`effective`, `usesDefaults`, `settled` and `reason`; an existing-object/edit guard
or a failed startup cannot claim that the selected settings applied. `capture()`
continues returning the actual complete scene settings without saving anything.
