// Project the runtime allocation preflight without disabling intermediate
// choices: the operator may change width and height in either order.
export function syncVolumeGridOptions(select, previewGridShape, gridHeightRatio) {
  if (!select || !previewGridShape) return;
  for (const option of select.options) {
    const preview = previewGridShape({resolution:Number(option.value), gridHeightRatio});
    const refused = preview.limitsChecked === true && preview.admitted === false;
    option.disabled = false;
    option.dataset.gridAdmission = refused ? 'refused' : preview.limitsChecked ? 'within-limits' : 'unchecked';
    option.style.color = refused ? '#777' : '';
    option.textContent = `${option.value}${refused ? ' · exceeds GPU limits' : ''}`;
    option.title = refused ? preview.admissionReason : preview.limitsChecked
      ? `${preview.dimensions.join('×')} · within allocation limits; shader compilation not tested`
      : 'GPU limits not checked yet';
  }
}
