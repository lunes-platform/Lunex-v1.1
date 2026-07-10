module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  // __tests__ fica fora do parser type-aware porque tsconfig.json exclui
  // testes do build (removeComments/declarations); os testes são validados
  // pelo próprio jest/ts-jest.
  ignorePatterns: ['dist/**', 'node_modules/**', 'examples/**', '**/__tests__/**'],
  rules: {
    'no-undef': 'off',
    'no-unused-vars': 'off',
    'no-extra-semi': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-namespace': 'off',
    '@typescript-eslint/no-require-imports': 'off',
  },
};
