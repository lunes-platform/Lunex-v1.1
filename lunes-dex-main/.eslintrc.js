module.exports = {
  root: true,
  extends: ['eslint-config-standard-with-typescript', 'plugin:react/recommended'],
  parserOptions: {
    project: './tsconfig.json'
  },
  plugins: ['react', 'prettier'],
  settings: {
    react: {
      version: 'detect'
    }
  },
  rules: {
    // Allow PascalCase for React components and styled-components
    '@typescript-eslint/naming-convention': [
      'warn',
      {
        selector: 'variable',
        format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
        leadingUnderscore: 'allow'
      },
      {
        selector: 'function',
        format: ['camelCase', 'PascalCase']
      },
      {
        selector: 'typeLike',
        format: ['PascalCase']
      }
    ],
    // Disable explicit return types for React components (common pattern)
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    // React specific
    'react/react-in-jsx-scope': 'off', // Not needed in React 17+
    'react/prop-types': 'off', // Using TypeScript for prop validation
    // Prettier integration
    'prettier/prettier': 'warn',
    // Allow any in some cases (can be strict later)
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/strict-boolean-expressions': 'off',
    '@typescript-eslint/no-floating-promises': 'off',
    '@typescript-eslint/no-misused-promises': 'off',
    // Disable minor stylistic rules
    '@typescript-eslint/prefer-nullish-coalescing': 'off',
    '@typescript-eslint/consistent-type-definitions': 'off',
    '@typescript-eslint/comma-dangle': 'off',
    '@typescript-eslint/consistent-indexed-object-style': 'off',
    '@typescript-eslint/member-delimiter-style': 'off',
    'spaced-comment': 'off',
    'no-trailing-spaces': 'off',
    'padded-blocks': 'off',
    'no-multiple-empty-lines': 'off',
    'eol-last': 'off',
    // Additional stylistic rules
    '@typescript-eslint/indent': 'off',
    '@typescript-eslint/quotes': 'off',
    '@typescript-eslint/object-curly-spacing': 'off',
    'multiline-ternary': 'off',
    'eqeqeq': 'warn',
    '@typescript-eslint/prefer-includes': 'warn',
    // Unused vars as warning to allow gradual cleanup
    '@typescript-eslint/no-unused-vars': 'warn',
    // Disable space before function parentheses rule
    '@typescript-eslint/space-before-function-paren': 'off',
    'space-before-function-paren': 'off'
  }
}
