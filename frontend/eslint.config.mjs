import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import tailwindPlugin from "eslint-plugin-tailwindcss";

const tailwindRecommended = tailwindPlugin.configs.recommended;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...(Array.isArray(tailwindRecommended)
    ? tailwindRecommended
    : [tailwindRecommended]),
  {
    settings: {
      tailwindcss: {
        cssConfigPath: "./src/app/globals.css",
      },
    },
  },
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
