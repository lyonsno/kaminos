[Live Demo](https://jure.github.io/webphysics/)



https://github.com/user-attachments/assets/f61714a2-8df6-4b7d-b22e-c3722155fe17


<p align="center">
  <img src="./webphysics-logo.svg" alt="webphysics" width="420" />
</p>

[Live Demo](https://jure.github.io/webphysics/)

# webphysics

This project is an **experimental** WebGPU rigid-body / soft-body physics prototype centered on an AVBD-style ([Augmented Vertex Block Descent by Giles et al. (2025)](https://graphics.cs.utah.edu/research/projects/avbd/Augmented_VBD-SIGGRAPH25.pdf)) solver. I ❤ working on [advanced¹](https://github.com/jure/webgiya) [web graphics²](https://jure.github.io/nobigi/) [open source experiments³](https://bsky.app/profile/juretriglav.bsky.social/post/3mfar45bfis24), so if you'd like to see more projects like these, please [support my work](https://github.com/sponsors/jure).️

## Setup

```sh
npm install
npm run dev
```

Build for production:

```sh
npm run build
```

Note: This is not a plug-and-play module yet and browser support (Chrome only for now) is limited, it's an initial proof of concept.

## AVBD Pipeline

The current rigid-body pipeline follows the structure of Algorithm 1 from the AVBD paper, with broad phase, narrow phase, warm-started contact state, colored body solves, dual updates, and final velocity reconstruction. Reference paper: [Augmented Vertex Block Descent by Giles et al. (2025)](https://graphics.cs.utah.edu/research/projects/avbd/Augmented_VBD-SIGGRAPH25.pdf)

1. **Collision detection from the current state `x^t`**
   The paper starts each time step with collision detection from the current positions, before the solver iterations begin. In this codebase that starts in the main substep orchestration in [src/physics/PhysicsEngine.ts](https://github.com/jure/webphysics/blob/main/src/physics/PhysicsEngine.ts), then flows into broad phase and narrow phase.

2. **Broad phase candidate generation**
   As described in Section 4 of the paper, we first build and traverse an LBVH to get candidate body pairs. Code:
   - [src/physics/gpu/broadPhase.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/broadPhase.ts)
   - [src/lvbh/GPULBVHBuilder.ts](https://github.com/jure/webphysics/blob/main/src/lvbh/GPULBVHBuilder.ts)

3. **Narrow phase manifold generation and warm-start persistence**
   Once candidate pairs exist, discrete narrow-phase contact generation builds manifolds and preserves per-contact state used for warm starting and friction handling, matching Sections 3.3, 3.7, and 4 of the paper. Code:
   - [src/physics/gpu/contactGeneration.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/contactGeneration.ts)
   - [src/physics/gpu/contactRecord.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/contactRecord.ts)

4. **Per-body constraint list construction**
   Algorithm 1 is written as “for each body / vertex, iterate over each force affecting it.” The runtime representation of that step is the per-body constraint gather built from contacts, joints, and springs. Code:
   - [src/physics/gpu/contactGeneration.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/contactGeneration.ts)
   - [src/physics/gpu/avbdState.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/avbdState.ts)

5. **Coloring**
   The paper uses greedy coloring so all bodies of a given color can be processed in parallel during the primal step. That preparation happens in:
   - [src/physics/gpu/avbdState.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/avbdState.ts)

6. **Inertial target and primal initialization**
   Algorithm 1 next builds the inertial target `y`, initializes the primal state, and warm-starts dual / stiffness variables with the `alpha` and `gamma` scaling discussed in Sections 3.6 and 3.7. Code:
   - [src/physics/gpu/avbdState.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/avbdState.ts)
   - [src/physics/PhysicsEngine.ts](https://github.com/jure/webphysics/blob/main/src/physics/PhysicsEngine.ts)

7. **Main AVBD iteration: colored primal body solve**
   For each iteration, and for each color, the solver accumulates inertial and constraint contributions for a body, assembles the local rigid-body system, and applies the AVBD primal update. This corresponds to Algorithm 1 lines 7-25 and the approximate-Hessian discussion in Section 3.5. Code:
   - [src/physics/gpu/avbdState.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/avbdState.ts)

8. **Dual and stiffness update**
   After each primal sweep, dual variables and stiffness values are updated in parallel, corresponding to the augmented-Lagrangian / stiffness-ramp rules from the paper. Code:
   - [src/physics/gpu/avbdState.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/avbdState.ts)

9. **Finalize velocities**
   After the AVBD position solve is complete, velocities are reconstructed from the updated state, matching the final stage of Algorithm 1. Code:
   - [src/physics/gpu/avbdState.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/avbdState.ts)
   - [src/physics/PhysicsEngine.ts](https://github.com/jure/webphysics/blob/main/src/physics/PhysicsEngine.ts)

10. **Optional post-processing**
   Sleep and diagnostics are outside the core AVBD paper loop and are optional runtime features in this project. The main orchestration remains in:
   - [src/physics/PhysicsEngine.ts](https://github.com/jure/webphysics/blob/main/src/physics/PhysicsEngine.ts)

## Note on Current Implementation

The broad pipeline matches the paper closely:

`collision detection -> coloring -> inertial/primal init -> repeated colored primal solves -> dual updates -> finalize velocities`

This is an initial experimental release and further updates will be focused on stability, performance and ease of use. One important implementation difference is that the paper explicitly describes double-buffered position updates for rare same-color conflicts, whereas the current path is still fundamentally an in-place colored body solve in [src/physics/gpu/avbdState.ts](https://github.com/jure/webphysics/blob/main/src/physics/gpu/avbdState.ts).
