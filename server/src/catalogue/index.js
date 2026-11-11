// server/src/catalogue/index.js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const merchants = JSON.parse(readFileSync(fileURLToPath(new URL('./merchants.json', import.meta.url)), 'utf8'));
const products = JSON.parse(readFileSync(fileURLToPath(new URL('./products.json', import.meta.url)), 'utf8'));

export function getMerchants() { return merchants.map((merchant) => ({ ...merchant })); }
export function getProducts() { return products.map((product) => ({ ...product })); }
export function getProduct(id) {
  const product = products.find((entry) => entry.product_id === id);
  return product ? { ...product } : null;
}
export function buildCatalogueMap() {
  return new Map(products.map((product) => [product.product_id, { ...product }]));
}

export { searchProducts, getDiscoveryStatus } from './discovery.js';
