import { readFileSync } from 'node:fs';
import { AppError } from './domain.mjs';

const data = JSON.parse(readFileSync(new URL('./data/guangzhou-catalog.json', import.meta.url), 'utf8'));
export const catalogMeta = Object.freeze(data.metadata);
export const catalogRows = Object.freeze(data.rows.map(Object.freeze));
export const catalogProducts = Object.freeze([...Map.groupBy(catalogRows, r => r.product_id)].map(([id, rows]) => Object.freeze({
  id, name: rows[0].product_name, category: rows[0].category, variants: Object.freeze(rows)
})));

export function listCatalog({ query = '', category = '', offset = 0, limit = 30 } = {}) {
  if (typeof query !== 'string' || query.length > 100 || typeof category !== 'string') throw new AppError('产品查询条件不正确。');
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 104) throw new AppError('产品分页范围不正确。');
  const products = catalogProducts.filter(p => (!category || p.category === category) && (!query || `${p.name} ${p.category} ${p.variants[0].main_ingredient_tags}`.includes(query)));
  return { metadata: catalogMeta, categories: [...new Set(catalogProducts.map(p => p.category))], total: products.length, offset, limit,
    products: products.slice(offset, offset + limit) };
}

// These IDs identify local research records, never orderable official product codes.
export function catalogReference(query = '', category = '') {
  const result = listCatalog({ query, category, limit: 30 });
  return { metadata: catalogMeta, total: result.total, products: result.products.map(p => ({
    catalogId: p.id, name: p.name, category: p.category, ingredients: p.variants[0].main_ingredient_tags,
    spice: p.variants[0].spice_tag, spiceBasis: p.variants[0].spice_basis_type,
    allergenStatus: p.variants[0].allergen_status, knownAllergens: p.variants[0].identified_allergen_tags,
    variants: p.variants.map(r => ({ label: r.serving_label, kcal: r.energy_kcal, proteinG: r.protein_g,
      sodiumMg: r.sodium_mg, nutritionStatus: r.nutrition_status, source: r.nutrition_source_url }))
  })) };
}
