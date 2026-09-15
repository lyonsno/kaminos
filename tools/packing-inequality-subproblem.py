"""Experimental local minimax subproblem; stdin JSON -> stdout JSON, no geometry."""
import json
import sys
import numpy as np
import scipy
from scipy.optimize import minimize


def solve(p):
    a = np.asarray(p['jacobian'], dtype=float)
    b = np.asarray(p['gaps'], dtype=float)
    pair = np.asarray(p['pair'], dtype=float)
    n = a.shape[1]
    radius = float(p['radius'])
    assert a.shape == (len(b), n) and pair.shape == b.shape
    assert np.isfinite(a).all() and np.isfinite(b).all() and radius > 0
    bounds = p['bounds'] + [[0, None]]
    initial = np.r_[np.zeros(n), max(0., float(np.max(-b[pair == 1])))]
    matrix = np.column_stack([a, pair])
    constraints = [
        {'type': 'ineq', 'fun': lambda z: b + matrix @ z,
         'jac': lambda z: matrix},
        {'type': 'ineq', 'fun': lambda z: radius**2 - z[:n] @ z[:n],
         'jac': lambda z: np.r_[-2 * z[:n], 0.]},
    ]
    first = minimize(lambda z: z[-1], initial, jac=lambda z: np.r_[np.zeros(n), 1.],
                     method='SLSQP', bounds=bounds, constraints=constraints,
                     options={'ftol': 1e-10})
    def receipt(r):
        return {'success': bool(r.success), 'message': str(r.message),
                'iterations': int(r.nit), 'x': r.x.tolist(),
                'minimumSlack': float(np.min(b + matrix @ r.x)),
                'norm': float(np.linalg.norm(r.x[:n]))}
    result = {'scipyVersion': scipy.__version__, 'minimax': receipt(first)}
    if not first.success:
        result['status'] = 'subproblem-failed'
        return result
    # Resolve the minimax tie by minimum displacement, not an arbitrary merit weight.
    second_bounds = bounds[:-1] + [[float(first.x[-1]), float(first.x[-1])]]
    second = minimize(lambda z: .5 * (z[:n] @ z[:n]), first.x,
                      jac=lambda z: np.r_[z[:n], 0.], method='SLSQP',
                      bounds=second_bounds, constraints=constraints,
                      options={'ftol': 1e-10})
    result['minimumNorm'] = receipt(second)
    valid = (second.success and np.isfinite(second.x).all()
             and result['minimumNorm']['minimumSlack'] >= -1e-8
             and result['minimumNorm']['norm'] <= radius + 1e-8)
    result.update(status='solved' if valid else 'subproblem-failed', direction=second.x[:n].tolist())
    return result


if __name__ == '__main__':
    try:
        print(json.dumps(solve(json.load(sys.stdin)), allow_nan=False))
    except Exception as exc:
        print(json.dumps({'status': 'subproblem-error', 'error': str(exc)}))
        sys.exit(1)
