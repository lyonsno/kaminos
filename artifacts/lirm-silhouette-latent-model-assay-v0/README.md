# Learned Silhouette Latent Assay

This compact artifact preserves the corrected visual and receipt evidence for three MLX convolutional SDF VAE regimes trained on 2,421 anonymous canonical organism silhouettes.

The source runs decoded foreground with the wrong sign in their witness path. Their trained checkpoints and saved normalized SDF fields remain valid. `lirm-silhouette-latent-reassay.py` reuses those fields without mutating the source runs, decodes `normalized_sdf > 0`, recomputes novelty and topology usability, and records each source receipt hash.

## Verdict

- `beta-0.01`: selected global-prior regime; 48/48 accepted, including 16/16 direct prior samples.
- `beta-0.001`: selected seed-local interpolation/mutation specialist; 31/48 accepted, with all 16 direct prior samples rejected for frame contact.
- `beta-0.05`: stable but over-regularized; 47/48 accepted with visibly reduced gestalt diversity.

The three contact sheets were inspected at original resolution. Acceptance requires a nonempty, nonfull, frame-contained mask whose nearest source or horizontal mirror remains below the configured IoU copy threshold. Multipart silhouettes are measured and retained because separate appendages and organism masses are legitimate topology.
