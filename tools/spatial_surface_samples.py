"""Select and fit a fixed number of surface samples from a retained candidate pool."""
import numpy as np


def spatial_samples(rows, count, area):
    rows = np.asarray(rows)
    if (rows.ndim != 2 or rows.shape[1] != 12 or not np.isfinite(rows).all()
            or not isinstance(count, int) or not 1 <= count <= len(rows)
            or not np.isfinite(area) or area <= 0):
        raise ValueError('Finite surface rows, positive area and attainable count required')
    pos, normal = rows[:, :3].astype(np.float64), rows[:, 3:6].astype(np.float64)
    length = np.linalg.norm(normal, axis=1)
    if np.any(length < 1e-12):
        raise ValueError('Surface normals required')
    normal /= length[:, None]
    dominant = np.argmax(np.abs(normal), axis=1)
    normal_bin = dominant*2 + (normal[np.arange(len(rows)), dominant] < 0)
    origin = pos.min(0)

    def keys(width):
        cell = np.floor((pos-origin)/width).astype(np.int64)
        # A structured key avoids coordinate hashing collisions or fixed grid limits.
        values = np.c_[cell, normal_bin]
        return np.ascontiguousarray(values).view(np.dtype((np.void, values.dtype.itemsize*4))).ravel()

    # Select one representative per spatial/normal cell, then fill the exact budget.
    # Bisection is a bounded search for a grouping, not a bound on source/output rows.
    low, high = 0., max(float(np.linalg.norm(np.ptp(pos, axis=0))), np.sqrt(area/count))
    width, best = high, 0
    for _ in range(18):
        middle = (low+high)/2
        size = len(np.unique(keys(middle)))
        if size <= count:
            high = middle
            if size > best:
                width, best = middle, size
        else:
            low = middle
    if best == 0:
        raise ValueError('Requested count cannot retain the normal populations')
    _, inverse, population = np.unique(keys(width), return_inverse=True, return_counts=True)
    groups = len(population)
    mean = np.column_stack([np.bincount(inverse, weights=pos[:, j])/population for j in range(3)])
    distance = np.sum((pos-mean[inverse])**2, axis=1)
    order = np.lexsort((np.arange(len(rows)), distance, inverse))
    start = np.r_[True, inverse[order[1:]] != inverse[order[:-1]]]
    representatives = order[start]
    remaining = count-groups
    if remaining:
        eligible = np.ones(len(rows), bool); eligible[representatives] = False
        candidates = np.flatnonzero(eligible)
        separation = np.sum((pos[candidates]-pos[representatives[inverse[candidates]]])**2, axis=1)
        extra = candidates[np.argsort(-separation, kind='stable')[:remaining]]
        ids = np.r_[representatives, extra]
    else:
        ids = representatives

    # Fit each cell's retained geometry in the selected point's tangent plane.
    delta = pos-mean[inverse]
    covariance = np.empty((groups, 3, 3))
    for i in range(3):
        for j in range(3):
            covariance[:, i, j] = np.bincount(inverse, weights=delta[:, i]*delta[:, j])/population
    shift = mean[inverse[ids]]-pos[ids]
    local = covariance[inverse[ids]] + shift[:, :, None]*shift[:, None, :]
    n = normal[ids]
    axis = np.tile([0., 0., 1.], (count, 1)); axis[np.abs(n[:, 2]) > .9] = [1, 0, 0]
    u = np.cross(n, axis); u /= np.linalg.norm(u, axis=1)[:, None]
    v = np.cross(n, u)
    frame = np.stack([u, v], axis=2)
    tangent_cov = np.einsum('nki,nkl,nlj->nij', frame, local, frame)
    eigenvalue, eigenvector = np.linalg.eigh(tangent_cov)
    axes = frame @ eigenvector
    reflected = np.sum(np.cross(axes[:, :, 0], axes[:, :, 1])*n, axis=1) < 0
    axes[reflected, :, 1] *= -1  # Ellipse unchanged; quad winding follows the source normal.
    # sqrt(6*variance) covers a uniformly occupied cell's tangent-plane corners.
    sigma = np.sqrt(np.maximum(eigenvalue, (width*.04)**2)*6)/3
    sigma[population[inverse[ids]] == 1] = width*.7/3
    footprints = np.empty((count, 8), '<f4')
    footprints[:, :3] = axes[:, :, 0]; footprints[:, 4:7] = axes[:, :, 1]
    footprints[:, 3] = sigma[:, 0]; footprints[:, 7] = sigma[:, 1]
    return ids, footprints, {'candidateCount': len(rows), 'count': count,
            'cellWidth': width, 'occupiedCells': groups, 'extraSamples': remaining,
            'normalBins': 6, 'searchIterations': 18,
            'selection': 'nearest existing candidate to cell centroid; separated extras',
            'support': 'tangent covariance of candidate cell; 3-sigma corner coverage'}
