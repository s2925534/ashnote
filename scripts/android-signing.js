// CI helper: after `expo prebuild`, make the release build sign with the upload keystore.
// The keystore details come from environment variables set on the CI build step
// (ASHNOTE_STORE_FILE, ASHNOTE_STORE_PASSWORD, ASHNOTE_KEY_ALIAS, ASHNOTE_KEY_PASSWORD),
// read with System.getenv so the passwords are never written to a file and no escaping
// is needed. (Bare property names inside signingConfigs don't resolve with AGP 9.)
const fs = require('fs');
const file = 'android/app/build.gradle';
let g = fs.readFileSync(file, 'utf8');
if (!g.includes('ASHNOTE_STORE_FILE')) {
  g = g.replace(
    /signingConfigs\s*\{/,
    `signingConfigs {
        upload {
            storeFile file(System.getenv("ASHNOTE_STORE_FILE"))
            storePassword System.getenv("ASHNOTE_STORE_PASSWORD")
            keyAlias System.getenv("ASHNOTE_KEY_ALIAS")
            keyPassword System.getenv("ASHNOTE_KEY_PASSWORD")
        }`,
  );
  const before = g;
  g = g.replace(/(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.upload');
  if (g === before) throw new Error('could not find the release signingConfig in build.gradle');
  fs.writeFileSync(file, g);
}
console.log('release build signs with the upload key');
