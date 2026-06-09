// Flat ESLint config (ESLint 9+).
// Goals: catch real bugs (unused vars that aren't intentional, hooks rules,
// React mistakes), stay out of formatting (Prettier owns that), don't get
// in our way.

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/.codegraph/**",
      "**/next-env.d.ts"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // TypeScript / TSX files
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    plugins: {
      react,
      "react-hooks": reactHooks
    },
    settings: {
      react: { version: "detect" }
    },
    rules: {
      // React 17+ JSX transform — no need to import React in scope
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // We type props with TS instead
      "react/display-name": "off",
      // Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Underscore-prefixed unused args/vars are intentional
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      // Allow `any` for now — production tightens via zod in Phase 1
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unused expressions like `condition && doThing()`
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }]
    }
  },
  // Tests get a slightly looser ruleset
  {
    files: ["**/*.{test,spec}.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  // Plain JS / config files (ESM)
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
];
