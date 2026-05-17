module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "security", "no-secrets"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:security/recommended",
  ],
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "no-console": "warn",
    "security/detect-object-injection": "warn",
    "security/detect-non-literal-fs-filename": "error",
    "no-secrets/no-secrets": "error",
    // Enforce no eval - Cybersecurity Act 1038
    "no-eval": "error",
    "no-implied-eval": "error",
  },
  env: {
    node: true,
    es2022: true,
  },
};
