import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'attacks', 'results.json');
const destinationDirectory = path.join(root, 'public', 'attacks');
mkdirSync(destinationDirectory, { recursive: true });
copyFileSync(source, path.join(destinationDirectory, 'results.json'));
console.log('Published attacks/results.json to public/attacks/results.json');
