module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module:react-native-dotenv', {
        moduleName: '@env',
        path: '.env',
        allowUndefined: true
      }],
      // optional, only if you're using aliases
      ['module-resolver', {
        root: ['./'],
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        alias: {
          '@': './src',
          '@components': './src/components',
          '@pages': './src/pages',
          '@api': './src/api',
          '@utils': './src/utils',
          '@hooks': './src/hooks',
          '@lib': './src/lib',
        },
      }],
    ],
  };
};
