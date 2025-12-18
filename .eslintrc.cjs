module.exports = {
	root: true,
	env: {
		node: true,
		es2020: true,
	},
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'prettier',
	],
	ignorePatterns: [
		'dist',
		'.eslintrc.cjs',
		'node_modules',
		'src/focus-data',
		'*.js',
		'api',
		'scripts',
		'todoist-data-fetcher',
	],
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: 'module',
		project: './tsconfig.json',
		tsconfigRootDir: __dirname,
	},
	plugins: ['@typescript-eslint'],
	rules: {
		// TypeScript-specific overrides
		'@typescript-eslint/no-unused-vars': [
			'error',
			{
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			},
		],

		// Node.js best practices
		'no-console': 'off',
		'no-process-env': 'off',

		// General code quality
		'no-unused-expressions': 'error',
		'prefer-const': 'error',
		'no-var': 'error',
	},
};
