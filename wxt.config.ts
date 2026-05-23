import { defineConfig } from "wxt";

const hostPermissions = [
  "https://gfc-russia.ru/*",
  "https://*.gfc-russia.ru/*",
  "https://smartpro.ru/*",
  "https://*.smartpro.ru/*",
  "https://metro-cc.ru/*",
  "https://*.metro-cc.ru/*",
  "https://swlife.ru/*",
  "https://*.swlife.ru/*",
  "https://app.iirest.ru/*",
  "https://iirest.ru/*",
  "https://*.iirest.ru/*",
  "http://localhost/*",
  "http://127.0.0.1/*"
];

const icons = {
  "16": "icon-16.png",
  "32": "icon-32.png",
  "48": "icon-48.png",
  "128": "icon-128.png"
};

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => {
    const isYandex = browser === "yandex";
    const name = isYandex ? "iiRest Exporter (Yandex Browser)" : "iiRest Exporter";

    return {
      name,
      version: "0.1.0",
      description: "Searches supplier marketplaces and exports found products to CSV.",
      permissions: ["storage", "tabs", "scripting", "downloads"],
      host_permissions: hostPermissions,
      icons,
      action: {
        default_title: name,
        default_icon: {
          "16": icons["16"],
          "32": icons["32"]
        }
      }
    };
  }
});
