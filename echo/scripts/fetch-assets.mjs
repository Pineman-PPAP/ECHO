// Copies the MediaPipe WASM runtime out of node_modules and downloads the face model, so the game
// runs fully offline (venue Wi-Fi is unreliable). Safe to re-run. Usage: npm run assets
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'mediapipe', 'wasm');
await mkdir(wasmDst, { recursive: true });
await cp(wasmSrc, wasmDst, { recursive: true });
console.log(`[assets] copied MediaPipe wasm -> ${wasmDst}`);

const modelDst = join(root, 'public', 'models', 'face_landmarker.task');
await mkdir(dirname(modelDst), { recursive: true });
let haveModel = false;
try {
  haveModel = (await stat(modelDst)).size > 1_000_000;
} catch {
  haveModel = false;
}
if (haveModel) {
  console.log(`[assets] model already present -> ${modelDst}`);
} else {
  console.log(`[assets] downloading ${MODEL_URL}`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`[assets] model download failed: HTTP ${res.status}`);
  await writeFile(modelDst, Buffer.from(await res.arrayBuffer()));
  console.log(`[assets] saved model -> ${modelDst}`);
}
