import { createDomSupplierAdapter, type ApiSearchConfig } from "./dom-search";

const searchInputSelectors = [
  "#input-smartsearch",
  ".smartsearch__bar input",
  'input[type="search"]',
  'input[name="search"]',
  'input[name="query"]',
  '[data-show="search"] input',
  '[class*="search"] input'
];

const productRowSelectors = [
  ".smartsearch__product",
  ".product-thumb.card",
  ".product-thumb",
  '[data-product-id]',
  'article:has(a[href*="swlife.ru/"])',
  '[class*="product"][class*="card"]'
];

const nameSelectors = [
  ".smartsearch__product-name",
  ".card-title a",
  '[data-name]',
  'a[href*="swlife.ru/"][title]',
  'a[href*="swlife.ru/"]',
  '[class*="product-name"]',
  ".name",
  ".title"
];

const unitSelectors = [
  ".product-thumb__quantum",
  "[data-unit]",
  '[class*="quantum"]',
  '[class*="unit"]',
  '[class*="measure"]',
  '[class*="packing"]'
];

const priceSelectors = [
  ".smartsearch__product-price",
  ".product-thumb__price-special",
  ".product-thumb__price-base",
  ".product-thumb__price",
  '[class*="price"]'
];

const apiSearchConfigs: ApiSearchConfig[] = [
  {
    url: "https://swlife.ru/index.php?route=extension/module/smartsearch&language=ru-ru&location=1&isWeb=true&limit=1000",
    queryParam: "query"
  }
];

export const sweetlifeAdapter = createDomSupplierAdapter({
  id: "sweetlife",
  name: "Sweet Life",
  startUrl: "https://swlife.ru/",
  loginUrl: "https://swlife.ru/login",
  selectors: {
    searchInput: searchInputSelectors,
    productRows: productRowSelectors,
    name: nameSelectors,
    unit: unitSelectors,
    price: priceSelectors
  },
  cartSelectors: {
    addButton: [
      ".smartsearch__cart-add",
      ".product-thumb__button-cart",
      'button[data-product="cart"]',
      'button[class*="cart"]',
      '[class*="cart"] button',
      'button:has(svg)'
    ],
    quantityInput: [
      ".smartsearch__cart-regulator input",
      ".quantity-regulator input",
      'input[name="quantity"]',
      'input[class*="quantity"]',
      'input[type="number"]',
      'input[type="text"][data-quantity]'
    ],
    productLink: [
      ".smartsearch__product-name",
      ".product-thumb__image",
      ".card-title a",
      'a[href*="swlife.ru/"]',
      "a[href]"
    ]
  },
  apiSearchConfigs
});
