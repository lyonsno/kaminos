// Project the runtime allocation preflight without disabling intermediate
// choices: the operator may change width and height in either order.
export function syncVolumeGridOptions(select, previewGridShape, gridHeightRatio) {
  if (!select || !previewGridShape) return;
  for (const option of select.options) {
    const preview = previewGridShape({resolution:Number(option.value), gridHeightRatio});
    const refused = preview.limitsChecked === true && preview.admitted === false;
    option.disabled = false;
    const admission = refused ? 'refused' : preview.limitsChecked ? 'within-limits' : 'unchecked';
    if (option.dataset.gridAdmission !== admission) option.dataset.gridAdmission = admission;
    option.style.color = refused ? '#777' : '';
    const text = `${option.value}${refused ? ' · exceeds GPU limits' : ''}`;
    const title = refused ? preview.admissionReason : preview.limitsChecked
      ? `${preview.dimensions.join('×')} · within allocation limits; shader compilation not tested`
      : 'GPU limits not checked yet';
    // Replacing identical option text disturbs an open native select menu.
    if (option.textContent !== text) option.textContent = text;
    if (option.title !== title) option.title = title;
  }
}
