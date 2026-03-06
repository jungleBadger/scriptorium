import js from "@eslint/js";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default [
  // --- Ignores ---
  { ignores: ["client/dist/**", "**/node_modules/**", "ingest/scripts/**"] },

  // --- Plain JS (server + tests + client JS) ---
  {
    files: ["**/*.js", "**/*.mjs"],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
    rules: {
      // Allow empty catch blocks (common intentional pattern in this codebase)
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Don't flag unused function parameters (Fastify handlers use (req, reply) convention)
      "no-unused-vars": ["error", { vars: "all", args: "none" }],
    },
  },

  // Node globals for server, tests, and CLI scripts
  {
    files: ["server/**/*.js", "tests/**/*.{js,mjs}", "scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node } },
  },

  // Browser globals for client JS
  {
    files: ["client/src/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },

  // --- Vue SFCs ---
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["client/src/**/*.vue"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Many components are intentionally single-word (Icon.vue, SearchBar.vue, etc.)
      "vue/multi-word-component-names": "off",
      // Relax prop-defaults — most props use defineProps shorthand without defaults
      "vue/require-default-prop": "off",
      // HTML formatting rules — belong to a formatter, not a linter
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/multiline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
      "vue/html-indent": "off",
    },
  },
];
