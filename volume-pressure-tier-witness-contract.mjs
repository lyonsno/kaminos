export function pressureTierDispatchEvidence(ledger, gridDimensions) {
  const [gridX, gridY, gridZ] = gridDimensions || [];
  const dispatches = ledger?.pressureTierDispatches;
  const validGrid = [gridX, gridY, gridZ].every(value => Number.isInteger(value) && value > 0);
  const fullY = validGrid ? Math.ceil(gridY / 4) : 0;
  const validDispatches = validGrid
    && Array.isArray(dispatches)
    && dispatches.length === 3
    && dispatches.every((dispatch, index) => dispatch.tier === index + 1
      && dispatch.workgroupsX === Math.ceil(gridX / 4)
      && dispatch.workgroupsZ === Math.ceil(gridZ / 4)
      && Number.isInteger(dispatch.workgroupsY)
      && dispatch.workgroupsY >= 1
      && dispatch.workgroupsY <= fullY
      && dispatch.pressureBuffer === ['B', 'A', 'B'][index])
    && dispatches[0].workgroupsY === fullY;
  const equivalentPasses = validDispatches
    ? 1 + Math.min(gridY, dispatches[1].workgroupsY * 4) / gridY
      + Math.min(gridY, dispatches[2].workgroupsY * 4) / gridY
    : null;
  const reported = Number(ledger?.pressureJacobiFullGridEquivalentPasses);
  return {
    equivalentPasses,
    reportedEquivalentPasses: reported,
    bounded: validDispatches && Number.isFinite(reported)
      && Math.abs(reported - equivalentPasses) < 1e-9,
  };
}
