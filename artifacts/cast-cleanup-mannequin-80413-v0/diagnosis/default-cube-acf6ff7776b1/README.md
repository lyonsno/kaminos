# Rejected default-cube cleanup run

This directory preserves the smallest replayable evidence for the first
`mannequin-80413` cleanup run. Greenroom job `acf6ff7776b1` executed the
requested `kaminos_blender_cast_cleanup` route through Blender 5.1.2 and exited
zero, but the worker incorrectly joined Blender's factory-startup cube with the
imported GLB before voxel remeshing.

The route therefore produced internally complete files that were visually and
semantically invalid. Both `source-left.png` and `gentle-left.png` show the
opaque cube. The independently parsed source has 148,476 vertices and 127,143
triangles; `cleanup-report.json` instead records 148,484 vertices and 127,155
triangles at source admission, exactly the cube's added eight vertices and
twelve triangles. The current validator rejects this report with `source
witness vertex count mismatch`.

Requested route: `kaminos_blender_cast_cleanup`

Effective route: `/Applications/Blender.app/Contents/MacOS/Blender
--background --factory-startup --python
/private/tmp/kaminos-mushfinger-cast-correspondence-0807/tools/blender-cast-cleanup.py
-- <frozen-source.glb> <output-directory>`

Registration/mount state: Greenroom receipt `acf6ff7776b1` is complete; this
run is rejected and is not a selectable cast candidate.

## File hashes

- `cleanup-report.json`: `97216f95ef6a4f598d05555c3b8286030711aff7618e5c554a0afbb790cad4d1`
- `cleanup-spec.json`: `1cf25ba34e7d52d39bb4bb31d2fa21fab2a387315f8f79df57991f80bd70c159`
- `gentle-left.png`: `79d7406f9bf0994b9776cec9553ed5761675cec7136ffe07f8c0fb2459905d3d`
- `receipt.json`: `54328b592fcd15d48542badb2603b40cb4677119ad916045a2edec94321354db`
- `source-left.png`: `8cce6c7eb5929cfbf1351d1bedb7950d1e289a057bba77b75c77f7d0e87ec011`
