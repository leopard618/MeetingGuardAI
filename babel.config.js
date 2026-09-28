// babel-preset-expo handles JSX/TS, EXPO_PUBLIC_* inlining and (if installed) the worklets plugin.
// Path aliases ("@/…") come from tsconfig.json "paths" (resolved by Expo's Metro config), so no
// module-resolver plugin is needed. Environment values are read from process.env.EXPO_PUBLIC_*
// in src/config/env.ts - there is no "@env" module any more.
module.exports = function (api) {
  api.cache(true);

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.BABEL_ENV === 'production';

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Strip console.log/info/debug from production bundles; keep console.error and console.warn.
      isProduction && ['transform-remove-console', { exclude: ['error', 'warn'] }],
    ].filter(Boolean),
  };
};
