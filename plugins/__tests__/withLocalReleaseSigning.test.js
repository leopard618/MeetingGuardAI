const fs = require('fs');
const path = require('path');

const withLocalReleaseSigning = require('../withLocalReleaseSigning');

const { SIGNING_ENV, addLocalReleaseSigning, isLocalSigningEnabled } = withLocalReleaseSigning;

// android/app/build.gradle exactly as `npx expo prebuild --platform android` generates it for this app
// (Expo SDK 57 template + the other plugins in app.config.js), without this plugin. Regenerate it when
// the Expo SDK changes: prebuild without MG_LOCAL_SIGNING and copy android/app/build.gradle here.
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'fixtures', 'app-build.gradle'), 'utf8').replace(/\r\n/g, '\n');

/** Body of the first `name {` block that starts at or after `from` (simple brace count, test input only). */
function blockBody(text, header, from = 0) {
  const start = text.indexOf(header, from);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}') depth -= 1;
    if (depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

const braceBalance = (text) => (text.match(/\{/g) || []).length - (text.match(/\}/g) || []).length;

describe('withLocalReleaseSigning', () => {
  describe('isLocalSigningEnabled', () => {
    it('is on only for MG_LOCAL_SIGNING=1', () => {
      expect(isLocalSigningEnabled({})).toBe(false);
      expect(isLocalSigningEnabled({ MG_LOCAL_SIGNING: '0' })).toBe(false);
      expect(isLocalSigningEnabled({ MG_LOCAL_SIGNING: 'true' })).toBe(false);
      expect(isLocalSigningEnabled({ MG_LOCAL_SIGNING: '1' })).toBe(true);
    });

    it('is never on for an EAS build', () => {
      expect(isLocalSigningEnabled({ MG_LOCAL_SIGNING: '1', EAS_BUILD: 'true' })).toBe(false);
      expect(isLocalSigningEnabled({ MG_LOCAL_SIGNING: '1', EAS_BUILD: '1' })).toBe(false);
    });
  });

  describe('config plugin', () => {
    const saved = { MG_LOCAL_SIGNING: process.env.MG_LOCAL_SIGNING, EAS_BUILD: process.env.EAS_BUILD };
    afterEach(() => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('leaves the config untouched without MG_LOCAL_SIGNING=1', () => {
      delete process.env.MG_LOCAL_SIGNING;
      delete process.env.EAS_BUILD;
      const config = { name: 'Meeting Guard AI', slug: 'meeting-guard-ai' };
      expect(withLocalReleaseSigning(config)).toBe(config);
      expect(config.mods).toBeUndefined();
    });

    it('registers an app/build.gradle mod with MG_LOCAL_SIGNING=1', () => {
      process.env.MG_LOCAL_SIGNING = '1';
      delete process.env.EAS_BUILD;
      const config = withLocalReleaseSigning({ name: 'Meeting Guard AI', slug: 'meeting-guard-ai' });
      expect(typeof config.mods?.android?.appBuildGradle).toBe('function');
    });
  });

  describe('addLocalReleaseSigning on the generated build.gradle', () => {
    const result = addLocalReleaseSigning(TEMPLATE);

    it('the fixture is the Expo template: release is signed with the debug key', () => {
      const release = blockBody(TEMPLATE, 'release {', TEMPLATE.indexOf('buildTypes {'));
      expect(release).toContain('signingConfig signingConfigs.debug');
    });

    it('adds a release signing config that reads every value from the environment', () => {
      const signingConfigs = blockBody(result, 'signingConfigs {');
      const release = blockBody(signingConfigs, 'release {');
      expect(release).toContain('storeFile file(mgReleaseStoreFile)');
      expect(release).toContain(`storePassword System.getenv('${SIGNING_ENV.storePassword}')`);
      expect(release).toContain(`keyAlias System.getenv('${SIGNING_ENV.keyAlias}')`);
      expect(release).toContain(`keyPassword System.getenv('${SIGNING_ENV.keyPassword}')`);
      expect(result).toContain(`def mgReleaseStoreFile = System.getenv('${SIGNING_ENV.storeFile}') ?: ''`);
      // The debug signing config is unchanged.
      expect(blockBody(signingConfigs, 'debug {')).toBe(blockBody(blockBody(TEMPLATE, 'signingConfigs {'), 'debug {'));
    });

    it('never writes a password literal: the only literal passwords are the public debug ones', () => {
      const literalPasswords = [...result.matchAll(/(?:storePassword|keyPassword)\s+['"]([^'"]*)['"]/g)].map((m) => m[1]);
      expect(literalPasswords).toEqual(['android', 'android']);
    });

    it('signs the release build type with the release config and keeps debug on the debug key', () => {
      const buildTypes = blockBody(result, 'buildTypes {');
      const release = blockBody(buildTypes, 'release {');
      expect(release).toMatch(/^\s*signingConfig signingConfigs\.release\s*$/m);
      expect(release).not.toMatch(/^\s*signingConfig signingConfigs\.debug\s*$/m);
      // The rest of the release build type is untouched.
      expect(release).toContain('minifyEnabled enableMinifyInReleaseBuilds');
      expect(blockBody(buildTypes, 'debug {')).toContain('signingConfig signingConfigs.debug');
    });

    it('stops a release task with a clear message when the environment is missing', () => {
      const envCheck = result.slice(0, result.indexOf('\nandroid {'));
      expect(envCheck).toContain("gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }");
      expect(envCheck).toContain('throw new GradleException(');
      expect(envCheck).toContain('npm run apk:test');
    });

    it('changes only the release signingConfig line and adds code; braces stay balanced', () => {
      // Template lines that are not found, in order, in the result.
      const resultLines = result.split('\n');
      let cursor = 0;
      const missing = [];
      for (const line of TEMPLATE.split('\n')) {
        const found = resultLines.indexOf(line, cursor);
        if (found === -1) missing.push(line.trim());
        else cursor = found + 1;
      }
      expect(missing).toEqual(['signingConfig signingConfigs.debug']);
      expect(braceBalance(result)).toBe(braceBalance(TEMPLATE));
    });

    it('is idempotent', () => {
      expect(addLocalReleaseSigning(result)).toBe(result);
    });

    it('keeps CRLF line endings', () => {
      const crlf = addLocalReleaseSigning(TEMPLATE.replace(/\n/g, '\r\n'));
      expect(crlf).toBe(result.replace(/\n/g, '\r\n'));
      expect(addLocalReleaseSigning(crlf)).toBe(crlf);
    });
  });

  describe('addLocalReleaseSigning on other template shapes', () => {
    it('adds the signingConfig line when the release build type has none', () => {
      const input = TEMPLATE.replace(/\n\s*signingConfig signingConfigs\.debug(?=\n\s*def enableShrinkResources)/, '');
      expect(blockBody(input, 'release {', input.indexOf('buildTypes {'))).not.toContain('signingConfig');
      const release = blockBody(blockBody(addLocalReleaseSigning(input), 'buildTypes {'), 'release {');
      expect(release).toContain('signingConfig signingConfigs.release');
    });

    it('fails clearly when an expected block is missing', () => {
      expect(() => addLocalReleaseSigning('apply plugin: "com.android.application"\n')).toThrow(
        /Could not find the top-level "android \{ \}" block/,
      );
      const noSigningConfigs = TEMPLATE.replace(/ {4}signingConfigs \{[\s\S]*?\n {4}\}\n/, '');
      expect(() => addLocalReleaseSigning(noSigningConfigs)).toThrow(/Could not find the "signingConfigs \{ \}" block/);
      const noReleaseType = TEMPLATE.replace(/ {8}release \{\n {12}\/\/ Caution![\s\S]*?\n {8}\}\n/, '');
      expect(() => addLocalReleaseSigning(noReleaseType)).toThrow(/Could not find the "release \{ \}" build type/);
    });

    it('refuses to overwrite a release signing config it did not add', () => {
      const withRelease = TEMPLATE.replace(
        '    signingConfigs {\n',
        "    signingConfigs {\n        release {\n            storeFile file('other.keystore')\n        }\n",
      );
      expect(() => addLocalReleaseSigning(withRelease)).toThrow(/already has a "release" signing config/);
    });
  });
});
