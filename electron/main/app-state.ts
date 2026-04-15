/**
 * Application quit state.
 *
 * Exposed as a function accessor (not a bare `export let`) so that every
 * import site reads the *live* value.  With `export let`, bundlers that
 * compile to CJS may snapshot the variable at import time, causing
 * `isQuitting` to stay `false` forever and preventing the window from
 * closing on Windows/Linux.
 */
let _isQuitting = false;
let _quitMode: 'normal' | 'update-install' = 'normal';

export function isQuitting(): boolean {
  return _isQuitting;
}

export function setQuitting(value = true, mode: 'normal' | 'update-install' = 'normal'): void {
  _isQuitting = value;
  _quitMode = value ? mode : 'normal';
}

export function isUpdateInstallQuit(): boolean {
  return _isQuitting && _quitMode === 'update-install';
}
