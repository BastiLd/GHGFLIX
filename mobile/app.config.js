// A local path or an EAS file environment variable. Never commit credentials.
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}) },
});
