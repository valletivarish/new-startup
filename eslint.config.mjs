// Flat ESLint config for the workspace.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/drizzle/meta/**',
      '.remember/**',
      'BRD\'s/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-executed config files use Node globals.
    files: ['**/*.mjs', '**/*.config.ts'],
    languageOptions: { globals: { process: 'readonly' } },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // The permission layer depends on this: role names must never gate code.
      // Authorization must check permission strings, never role names
      // (ADR-004). The audit found the original single-shape selector
      // evadable, so every comparison shape is covered: either operand, a
      // role-named variable, switch/case, and .includes() membership tests.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.property.name=/^(roleKey|role_key)$/][right.value=/^(owner|administrator|agent_manager|knowledge_manager|recruiter|analyst|viewer)$/]",
          message:
            'Authorization must check permission strings, never role names (ADR-004). Use the invariant helpers in @platform/permissions.',
        },
        {
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.value=/^(owner|administrator|agent_manager|knowledge_manager|recruiter|analyst|viewer)$/][right.property.name=/^(roleKey|role_key)$/]",
          message:
            'Authorization must check permission strings, never role names (ADR-004) — reversed operands are the same violation.',
        },
        {
          selector:
            "BinaryExpression[operator=/^(===|!==|==|!=)$/][left.name=/^(role|roleKey|roleName)$/][right.value=/^(owner|administrator|agent_manager|knowledge_manager|recruiter|analyst|viewer)$/]",
          message:
            'Authorization must check permission strings, never role names (ADR-004).',
        },
        {
          selector:
            "SwitchStatement > SwitchCase > Literal[value=/^(owner|administrator|agent_manager|knowledge_manager|recruiter|analyst|viewer)$/]",
          message:
            'Branching on role names is role-based authorization (ADR-004). Check permissions instead.',
        },
        {
          selector:
            "CallExpression[callee.property.name='includes'] > Literal[value=/^(owner|administrator|agent_manager|knowledge_manager|recruiter|analyst|viewer)$/]",
          message:
            'Role-name membership tests are role-based authorization (ADR-004). Check permissions instead.',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // The invariant helpers legitimately compare role keys; nothing else may.
    files: ['packages/permissions/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
