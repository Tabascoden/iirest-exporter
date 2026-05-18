import { createDomSupplierAdapter, type ApiSearchConfig } from "./dom-search";

const searchInputSelectors = [
  ".search-block__input input",
  ".catalog-search__search input",
  'input[placeholder="Поиск по каталогу"]',
  'input[type="search"]',
  'input[type="text"][placeholder*="Поиск"]',
  'input[name="q"]',
  'input[name="search"]',
  'input[placeholder*="Поиск"]',
  'input[placeholder*="поиск"]',
  '[data-testid*="search"] input'
];

const productRowSelectors = [
  ".search-block .card",
  ".results__item .card",
  ".main-content .card",
  ".list-content .card",
  ".card",
  '[data-testid*="product"]',
  ".product-card",
  ".product-row",
  ".catalog-item",
  ".marketplace-item",
  "table tbody tr"
];

const nameSelectors = [
  ".summary__name",
  '[data-testid*="name"]',
  ".product-name",
  ".name",
  ".title",
  "td:nth-child(1)",
  "td:nth-child(2)"
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
  ".price__new",
  ".summary__price .price__new",
  ".summary__price",
  '[data-testid*="price"]',
  ".price",
  ".product-price",
  'td[class*="price"]'
];

// Add verified SmartPro JSON search endpoints here after checking DevTools on an authorized account.
// /marketplace/ can redirect; use relative or absolute same-origin URLs and credentials: "include".
const apiSearchConfigs: ApiSearchConfig[] = [];

export const smartproAdapter = createDomSupplierAdapter({
  id: "smartpro",
  name: "SmartPro",
  startUrl: "https://smartpro.ru/marketplace/",
  loginUrl: "https://smartpro.ru/login/",
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
      'button[class*="basket"]',
      '[class*="basket"] button',
      'button:has(svg)'
    ],
    quantityInput: [
      '.counter input',
      '[class*="counter"] input',
      '[class*="quantity"] input',
      'input[type="number"]'
    ],
    productLink: [
      ".summary__name",
      'a[href*="/marketplace/"]',
      'a[href*="/product"]',
      "a[href]"
    ]
  },
  apiSearchConfigs
});
