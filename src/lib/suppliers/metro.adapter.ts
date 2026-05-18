import { createDomSupplierAdapter, type ApiSearchConfig } from "./dom-search";

const searchInputSelectors = [
  'input[placeholder*="Искать в METRO"]',
  'input[placeholder*="Искать"]',
  'input[type="search"]',
  'input[name="q"]',
  'input[name="search"]',
  '[data-testid*="search"] input',
  '[data-test*="search"] input',
  '[data-qa*="search"] input',
  '[class*="search"] input'
];

const productRowSelectors = [
  '[data-testid*="product-card"]',
  '[data-test*="product-card"]',
  '[data-qa*="product-card"]',
  '[data-product-id]',
  '[data-sku]',
  'article:has(a[href*="/products/"])',
  'li:has(a[href*="/products/"])',
  '[class*="product-card"]',
  '[class*="catalog-card"]',
  '[class*="catalog-product"]'
];

const nameSelectors = [
  'a[href*="/products/"][title]',
  '[data-testid*="product-name"]',
  '[data-test*="product-name"]',
  '[data-qa*="product-name"]',
  '[class*="product-card-name"]',
  '[class*="product-name"]',
  '[class*="name"]',
  'a[href*="/products/"]',
  "h1",
  "h2",
  "h3"
];

const unitSelectors = [
  '[data-testid*="unit"]',
  '[data-test*="unit"]',
  '[data-qa*="unit"]',
  '[class*="unit"]',
  '[class*="measure"]',
  '[class*="packing"]'
];

const priceSelectors = [
  '[data-testid*="price"]',
  '[data-test*="price"]',
  '[data-qa*="price"]',
  '[class*="price-current"]',
  '[class*="price-new"]',
  '[class*="price_actual"]',
  '[class*="price-actual"]',
  '[class*="current-price"]',
  '[class*="product-price"]',
  '[class*="price"]'
];

// Add verified METRO JSON search endpoints here only after checking DevTools
// in an authorized account. Keep credentials: "include"; never copy tokens.
const apiSearchConfigs: ApiSearchConfig[] = [];

export const metroAdapter = createDomSupplierAdapter({
  id: "metro",
  name: "METRO",
  startUrl: "https://online.metro-cc.ru/",
  loginUrl: "https://online.metro-cc.ru/login",
  selectors: {
    searchInput: searchInputSelectors,
    productRows: productRowSelectors,
    name: nameSelectors,
    unit: unitSelectors,
    price: priceSelectors
  },
  cartSelectors: {
    addButton: [
      'button[class*="cart"]',
      '[class*="cart"] button',
      '[data-testid*="cart"] button',
      '[data-test*="cart"] button',
      '[data-qa*="cart"] button',
      'button[aria-label*="корз"]',
      'button[title*="корз"]'
    ],
    quantityInput: [
      '[class*="counter"] input',
      '[class*="quantity"] input',
      '[data-testid*="quantity"] input',
      '[data-test*="quantity"] input',
      'input[inputmode="numeric"]',
      'input[inputmode="decimal"]',
      'input[type="number"]'
    ],
    productLink: [
      'a[href*="/products/"]',
      '[data-testid*="product-name"] a[href]',
      '[data-test*="product-name"] a[href]'
    ]
  },
  apiSearchConfigs
});
