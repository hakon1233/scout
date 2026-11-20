import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Type-aware rules: promises must be awaited or handled, switches over a union
  // cover every case, and no type assertion the checker already knows.
  // e2e/ is outside the root tsconfig, so it gets no type information.
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    ignores: ["e2e/**"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            {
              from: "package",
              package: "node:test",
              name: ["test", "it", "describe", "suite"],
            },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  // TODO(screens merge): these screens are being rewritten on another branch, so
  // their promise hits stay warnings for now. Once that lands, fix them and
  // delete this block so the rules are errors here too.
  {
    files: [
      "src/components/hosted/HostedTopics.tsx",
      "src/components/hosted/HostedSettings.tsx",
      "src/components/hosted/HostedChat.tsx",
      "src/components/hosted/SharingSection.tsx",
      "src/components/PickCards.tsx",
      "src/app/app/profile/**",
      "src/app/app/browse/**",
      "src/app/app/liked/**",
      "src/app/app/topics/**",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/switch-exhaustiveness-check": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated, git-ignored build artifacts — linting their minified bundles
    // floods the run with bogus errors once a local e2e/agent build exists.
    "e2e/.artifact/**",
    "packages/agent/webroot/**",
    "packages/agent/dist/**",
    // Agent worktrees: other checkouts, with their own builds.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
