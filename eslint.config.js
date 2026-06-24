import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['dist/**', 'node_modules/**', 'schemas/**', 'coverage/**'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			// The generator reads untyped JSON/YAML; explicit casts are intentional.
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
		}
	}
);
