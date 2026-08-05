import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettierConfig,
  {
    // Downgraded (not disabled) during the Next 16 migration - this rule is
    // new in eslint-config-next 16's bundled eslint-plugin-react-hooks v7 and
    // flags ~24 pre-existing setState-in-effect call sites across the app.
    // They're working code, not broken by this migration; each needs
    // individual judgment to refactor safely, tracked as a follow-up
    // (see the migration report). Kept as a real, visible warning rather
    // than silenced so the count doesn't quietly grow.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**'],
  },
];

export default config;
