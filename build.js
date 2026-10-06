// Copies just the site (no local server, notes or editor config) into dist/ for a static host.
// `npm run build`, then drag dist/ onto https://app.netlify.com/drop
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const out = new URL('./dist/', import.meta.url);

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const path of ['index.html', 'css', 'js']) {
  cpSync(new URL(path, root), new URL(path, out), { recursive: true });
}
console.log('Built dist/ (index.html, css, js). Drag the dist folder onto https://app.netlify.com/drop');
