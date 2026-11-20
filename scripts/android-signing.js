// CI helper: after `expo prebuild`, switch the release build type to the upload keystore
// whose details CI wrote into android/gradle.properties (ASHNOTE_* properties).
const fs = require('fs');
const file = 'android/app/build.gradle';
let g = fs.readFileSync(file, 'utf8');
if (!g.includes('ASHNOTE_STORE_FILE')) {
  g = g.replace(
    /signingConfigs\s*\{/,
    `signingConfigs {
        upload {
            storeFile file(ASHNOTE_STORE_FILE)
            storePassword ASHNOTE_STORE_PASSWORD
            keyAlias ASHNOTE_KEY_ALIAS
            keyPassword ASHNOTE_KEY_PASSWORD
        }`,
  );
  g = g.replace(/(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/, '$1signingConfig signingConfigs.upload');
  fs.writeFileSync(file, g);
}
console.log('release build signs with the upload key');
