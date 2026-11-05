// The page starts with <body class="kaminos-starting">, which shows a neutral
// "Starting Kaminos…" state in place of the sidebar until startup settles.
// The workspace layout is built at the end of startup; before that the raw
// sidebar markup is not a page anyone should land on.
export const STARTING_CLASS = 'kaminos-starting';
export const FAILED_CLASS = 'kaminos-startup-failed';

/** Update the startup veil text in place without extra DOM nodes or layout reflow. */
export function updateStartupVeil(document, phase) {
  if (!document?.body?.classList?.contains?.(STARTING_CLASS)) return false;
  const veil = document.getElementById?.('kaminos-startup-veil');
  if (!veil || (veil.children && veil.children.length > 0)) return false;
  const detail = typeof phase === 'string' ? phase.trim() : '';
  veil.textContent = detail ? `Starting Kaminos… · ${detail}` : 'Starting Kaminos…';
  if (detail) {
    if (!Array.isArray(document.__kaminosStartupVeilPhases)) document.__kaminosStartupVeilPhases = [];
    document.__kaminosStartupVeilPhases.push(veil.textContent);
  }
  return true;
}

/** Lift the veil when startup settles; a failure stays visible and is rethrown. */
export async function settleStartupVeil(document, startup) {
  let status = 'workspace-visible';
  try {
    return await startup;
  } catch (error) {
    status = 'failed';
    document.body.classList.add(FAILED_CLASS);
    throw error;
  } finally {
    document.defaultView?.kaminosStartup?.finish(status);
    document.body.classList.remove(STARTING_CLASS);
    document.getElementById('kaminos-startup-veil')?.remove();
  }
}
