import { App } from './app/App';
import { readFlags } from './app/flags';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');
const flags = readFlags();
try {
  const app = new App(root, flags);
  app.start();
  // DEV ONLY: lets automated checks drive the game in sim mode (see M2 "Verify"). Never exposed in real play.
  if (flags.sim) (window as unknown as { __echo?: App }).__echo = app;
} catch (err) {
  // Failures before the App exists (most likely no WebGL) would otherwise leave a silent black page.
  console.error('[ECHO] fatal startup error', err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent =
    'ECHO couldn’t start graphics (WebGL). Use Chromium with hardware acceleration enabled (chrome://settings → System).\n\n' +
    String(err);
  root.replaceChildren(box);
}
