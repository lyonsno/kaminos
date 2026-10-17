// Classic script in <head>, independent of the page module. If the module
// graph fails to load, top-level code throws, or a promise rejects unhandled
// while Kaminos is still starting, lift the veil and mark the failure so the
// broken page stays visible instead of hiding behind "Starting Kaminos…". A
// startup that hangs gets a way to show the page after 20 s. It also starts
// the runtime configuration request before the page module loads; the
// startup loader (runtime-config-once.mjs) adopts it.
(function () {
  var STARTING = 'kaminos-starting';
  var FAILED = 'kaminos-startup-failed';
  function starting() {
    return !!(document.body && document.body.classList.contains(STARTING));
  }
  function lift(failed) {
    if (!document.body) return;
    if (failed) document.body.classList.add(FAILED);
    document.body.classList.remove(STARTING);
    var veil = document.getElementById('kaminos-startup-veil');
    if (veil) veil.remove();
  }
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    var scriptFailure = !!(event && event.message) || !!(target && target.tagName === 'SCRIPT');
    if (scriptFailure && starting()) lift(true);
  }, true);
  window.addEventListener('unhandledrejection', function () {
    if (starting()) lift(true);
  });
  window.setTimeout(function () {
    if (!starting()) return;
    var veil = document.getElementById('kaminos-startup-veil');
    if (!veil) return;
    veil.textContent = 'Still starting Kaminos… ';
    var button = document.createElement('button');
    button.textContent = 'Show the page';
    button.addEventListener('click', function () { lift(false); });
    veil.append(button);
    veil.style.pointerEvents = 'auto';
  }, 20000);
  try {
    window.__kaminosEarlyRuntimeConfig = window.fetch('/api/runtime-config', { cache: 'no-store' });
  } catch (error) {
    window.__kaminosEarlyRuntimeConfig = null;
  }
})();
