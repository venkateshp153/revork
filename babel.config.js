module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      production: {
        // Remove console output from release builds so emails, sheet IDs and
        // tokens are never written to device logs.
        plugins: ['transform-remove-console'],
      },
    },
  };
};
