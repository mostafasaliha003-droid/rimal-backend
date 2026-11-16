/* global __dirname, process */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Bound build-time memory only when requested by the local preview procedure.
if (process.env.MKHADDA_LOCAL_BUILD_MAX_WORKERS) {
  const workers = Number(process.env.MKHADDA_LOCAL_BUILD_MAX_WORKERS);
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) {
    throw new Error('MKHADDA_LOCAL_BUILD_MAX_WORKERS must be an integer from 1 to 4.');
  }
  config.maxWorkers = workers;
}

module.exports = config;
