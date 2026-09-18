import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  tseslint.configs.recommended,
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "plugins/*/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
