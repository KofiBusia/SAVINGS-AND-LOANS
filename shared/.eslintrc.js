module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "no-eval": "error",
    "no-implied-eval": "error",
  },
  env: { node: true, es2022: true },
};
