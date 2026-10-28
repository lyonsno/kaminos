# Splash MLS-MPM Kernels

Verbatim upstream kernels and MIT license from `matsuoka-601/Splash`, revision
`3df5d621e6f153d7269037cbd8606bd83796f3fd`. The adapter in
`mls-juice-solver.mjs` adds lifetime fields in the original 80-byte particle
padding, skips inactive particles, and replaces the demo boundary tail with
world-scaled tray/sphere contact. The pressure/APIC transfers remain upstream
math. Model-time units are converted to seconds using upstream gravity 0.4 and
world gravity 9.81; this is a provisional weakly compressible visual fluid, not
an incompressibility or physical calibration claim.
