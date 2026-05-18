import { createDomSupplierAdapter, type ApiSearchConfig } from "./dom-search";

const searchInputSelectors = [
  'input[type="search"]',
  'input[name="q"]',
  'input[name="search"]',
  'input[placeholder*="Поиск"]',
  'input[placeholder*="поиск"]',
  '[data-testid*="search"] input'
];

const productRowSelectors = [
  '[data-cy="catalog-product"].catalog-product',
  '[data-cy="catalog-product"]',
  '.catalog-product[id^="catalog-product-"]',
  ".catalog-product"
];

const nameSelectors = [
  'a[id^="catalog-product-name-"]',
  'a[title][href*="view_type=catalog"]',
  '[data-testid*="name"]',
  ".catalog-product__name",
  ".catalog-product__title",
  ".product-name",
  ".name"
];

const unitSelectors = [
  '[data-testid*="unit"]',
  '[data-testid*="package"]',
  ".unit",
  ".package",
  ".packing",
  ".measure"
];

const priceSelectors = [
  '[data-pw="catalog-price"]',
  '[data-testid*="price"]',
  ".catalog-product__price",
  ".price",
  ".product-price"
];

// Add verified GFC JSON search endpoints here after checking DevTools on an authorized account.
// Keep credentials: "include" and do not copy tokens or secrets into the extension.
const apiSearchConfigs: ApiSearchConfig[] = [];

export const gfcAdapter = createDomSupplierAdapter({
  id: "gfc",
  name: "GFC Russia",
  startUrl: "https://gfc-russia.ru/",
  htmlSearchUrl: (query) => `https://gfc-russia.ru/catalog?searchQuery=${encodeURIComponent(query)}`,
  selectors: {
    searchInput: searchInputSelectors,
    productRows: productRowSelectors,
    name: nameSelectors,
    unit: unitSelectors,
    price: priceSelectors
  },
  cartSelectors: {
    addButton: [
      '[data-pw*="cart"]',
      '[data-cy*="cart"]',
      'button[id*="cart"]',
      'button[class*="cart"]',
      'button:has(svg)'
    ],
    quantityInput: [
      'input[id*="quantity"]',
      'input[name*="quantity"]',
      'input[class*="quantity"]',
      'input[type="number"]'
    ],
    productLink: [
      'a[id^="catalog-product-name-"]',
      'a[title][href*="view_type=catalog"]',
      'a[href*="/catalog/"]'
    ]
  },
  apiSearchConfigs
});
