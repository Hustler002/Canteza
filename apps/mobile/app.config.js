// Extends app.json with the one setting that cannot live there: where Firebase's config is.
//
// `google-services.json` is not committed (see .gitignore). On EAS it arrives as the secret
// file variable GOOGLE_SERVICES_JSON, which EAS sets to a path on the build machine; on a
// developer's machine it is the local file, if they have one. With neither, the setting is
// left out rather than pointed at a missing file -- that would fail every build -- and the
// app builds without push, which `src/lib/push.ts` already treats as "push unavailable".
//
// Everything else stays in app.json, which Expo passes in here as `config`.
const { existsSync } = require('node:fs');
const path = require('node:path');

const LOCAL_FILE = './google-services.json';

function googleServicesFile(env = process.env, localExists = existsSync) {
  if (env.GOOGLE_SERVICES_JSON) return env.GOOGLE_SERVICES_JSON;
  if (localExists(path.join(__dirname, LOCAL_FILE))) return LOCAL_FILE;
  return undefined;
}

module.exports = ({ config }) => {
  const file = googleServicesFile();
  return {
    ...config,
    android: {
      ...config.android,
      ...(file ? { googleServicesFile: file } : {}),
    },
  };
};

module.exports.googleServicesFile = googleServicesFile;
