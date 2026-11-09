// scripts/extract-all.js
import { getProducts } from '../server/src/catalogue/index.js';
import { extractListing } from '../server/src/llm/extractor.js';

for (const product of getProducts()) {
  const result = await extractListing(product);
  console.log(JSON.stringify({ product_id: product.product_id, ...result }));
}
