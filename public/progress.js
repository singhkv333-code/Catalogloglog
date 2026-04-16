// progress.js — thin top-of-page progress bar for page/data transitions.
// Usage:
//   import { startProgress, finishProgress } from './progress.js';
//   startProgress();          // kicks off the indeterminate crawl
//   await fetchData();
//   finishProgress();         // snaps to full width then fades out

let _bar = null;
let _timer = null;

function _ensureBar() {
  if (_bar) return _bar;
  _bar = document.createElement('div');
  _bar.id = 'catalog-progress-bar';
  document.body.prepend(_bar);
  return _bar;
}

export function startProgress() {
  const b = _ensureBar();
  clearTimeout(_timer);
  // Reset state cleanly
  b.classList.remove('is-done', 'is-loading');
  void b.offsetWidth; // force reflow so transition restarts
  b.classList.add('is-loading');
}

export function finishProgress() {
  const b = _ensureBar();
  clearTimeout(_timer);
  b.classList.remove('is-loading');
  void b.offsetWidth;
  b.classList.add('is-done');
  _timer = setTimeout(() => {
    b.classList.remove('is-done');
  }, 500);
}
