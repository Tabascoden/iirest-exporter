import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "iiRest Exporter",
    version: "0.1.0",
    description: "Searches supplier marketplaces and exports found products to CSV.",
    permissions: ["storage", "tabs", "scripting", "sidePanel", "downloads"],
    host_permissions: [
      "https://gfc-russia.ru/*",
      "https://*.gfc-russia.ru/*",
      "https://smartpro.ru/*",
      "https://*.smartpro.ru/*",
      "https://metro-cc.ru/*",
      "https://*.metro-cc.ru/*"
    ],
    icons: {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png"
    },
    action: {
      default_title: "iiRest Exporter",
      default_icon: {
        "16": "icon-16.png",
        "32": "icon-32.png"
      }
    },
    side_panel: {
      default_path: "sidepanel.html"
    }
  }
});
