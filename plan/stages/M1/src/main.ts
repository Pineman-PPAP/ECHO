import { App } from './app/App';
import { readFlags } from './app/flags';

const root = document.getElementById('app');
if (!root) throw new Error('#app missing from index.html');
new App(root, readFlags()).start();
