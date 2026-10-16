import { App } from './app/App';
import { readFlags } from './app/flags';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');
const flags = readFlags();
const app = new App(root, flags);
app.start();
// DEV ONLY: lets automated checks drive the game in sim mode (see M2 "Verify"). Never exposed in real play.
if (flags.sim) (window as unknown as { __echo?: App }).__echo = app;
