# IPBF implementation: numerical contract and current boundary

Source: Diaz et al., *Implicit Position-Based Fluids*, SIGGRAPH Asia 2025,
https://www.cemyuksel.com/research/papers/ipbf.pdf. Inspected author PDF SHA-256:
`1ebe17eccc978d2b6a795fb4f3ea2d09d1b44b9b6b27c3e3308ca3736b5ba159`.

`finger-fluid-ipbf-reference.mjs` is a deterministic CPU reference for the
pressure update and paper damping. It uses the normalized 3D cubic spline with
support radius R, physical particle masses, and a caller-specified rest density.
It is an offline reference, not a live solver implementation or performance claim.

The canonical energy is equation 7:

    E = alpha/(2 dt²) sum_i m_i |x_i-y_i|² + 1/2 sum_i C_i²
    C_i = max(rho_i/rho0 - 1, 0)
    rho_i = sum_j m_j W(x_i-x_j)

At each iteration, all density constraints and their derivatives are computed
from the same positions. For particle i, every active neighboring constraint
contributes to force and its local 3x3 Hessian, including constraint i. Derivatives
of a neighboring density with respect to x_i use m_i; derivatives of its own
density use the neighbors' masses. Self-kernel value contributes to density,
but its derivative with respect to the jointly moved self position is zero.

Equation 15's outer-product term is retained. Its second derivative contribution
is replaced by a diagonal whose entries are the Euclidean norms of that term's
columns (section 3.5). The inertia diagonal alpha*m_i/dt² is retained. Each
local system is solved and all particle positions simultaneously receive half
of the update, as in section 3.3 and algorithm 1. No PBF correction cap, lambda
clamp, tensile correction or 0.22 relaxation is applied.

An entirely inactive pressure block with zero force returns zero update; it does
not invert a zero Hessian. Active blocks are solved with Cholesky. A non-positive
pivot fails explicitly instead of silently adding a tunable stabilizer.

For damping, compute an alternative position in the last iteration from the
*start* of that iteration, using the same inertial positions and alpha*=0.001.
Equations 16–18 then remove only excess kinetic energy while retaining velocity
direction. beta defaults to 60; damping settings are exposed in the return.

## Source inconsistency and interpretation

The printed equations 10 and 11 include an extra 1/2 before sums of derivatives
of E_j, despite equation 7's energy and equation 15's stated derivative. The
reference differentiates equation 7 directly and checks that force independently
by finite differences. A uniform factor cancels from a zero-compliance Newton
update, but changes the meaning of nonzero compliance. This interpretation is
explicit; it is not an author-confirmed erratum or proof of bit identity with
the authors' CUDA implementation.

## Falsifiable checks

`node --test tests/finger-fluid-ipbf-reference.test.mjs` checks normalized kernel
integral; gradient and Hessian finite differences; total energy gradient with
unequal masses; clamped sparse pressure; the approximate-Hessian construction
and positive quadratic forms; simultaneous permutation-invariant updates;
translation covariance and zero net internal force; damping energy/direction;
last-iteration alternative state; and malformed numerical inputs.

GPU/reference conformance, boundary support, actual emission/basin behavior,
effective runtime settings and measured equal-simulated-time cost remain open.
Integration must account for the current solver's kernel/volume units and
non-pressure scheduling explicitly. The parent's packed-density branch is not
included in this reference branch; an adoption comparison must consume that
accepted baseline or name the missing optimization.
