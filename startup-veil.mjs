// The page starts with <body class="kaminos-starting">, which shows a neutral
// "Starting Kaminos…" state in place of the sidebar until startup settles.
// The workspace layout is built at the end of startup; before that the raw
// sidebar markup is not a page anyone should land on.
export const STARTING_CLASS = 'kaminos-starting';
export const FAILED_CLASS = 'kaminos-startup-failed';

/** Lift the veil when startup settles; a failure stays visible and is rethrown. */
export async function settleStartupVeil(document, startup) {
  try {
    return await startup;
  } catch (error) {
    document.body.classList.add(FAILED_CLASS);
    throw error;
  } finally {
    document.body.classList.remove(STARTING_CLASS);
    document.getElementById('kaminos-startup-veil')?.remove();
  }
}
