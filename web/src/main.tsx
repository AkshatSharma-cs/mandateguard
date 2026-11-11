import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import outfitRegular from '@fontsource/outfit/files/outfit-latin-400-normal.woff2?url';
import outfitMedium from '@fontsource/outfit/files/outfit-latin-500-normal.woff2?url';
import App from './App';
import { StoreProvider } from './state/store';
import './index.css';
import './lib/motion.css';

for (const href of [outfitRegular, outfitMedium]) {
  const preload = document.createElement('link');
  preload.rel = 'preload';
  preload.as = 'font';
  preload.type = 'font/woff2';
  preload.crossOrigin = 'anonymous';
  preload.href = href;
  document.head.appendChild(preload);
}

createRoot(document.getElementById('root')!).render(<StrictMode><StoreProvider><App /></StoreProvider></StrictMode>);
