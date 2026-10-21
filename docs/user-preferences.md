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
