import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  webExt: {
    disabled: process.env.WXT_MANUAL_DEV === "true",
    binaries: {
      chrome: process.env.WXT_CHROMIUM_BINARY ?? "./scripts/brave-flatpak"
    }
  },
  manifest: {
    name: "AI Council",
    description: "Run a demo AI council workflow from a Chrome side panel.",
    version: "0.1.0",
    permissions: ["storage", "tabs"],
    host_permissions: [],
    action: {
      default_title: "Open AI Council"
    }
  }
});
