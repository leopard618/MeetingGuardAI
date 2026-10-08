// Expo config plugin (Android): sign LOCAL release builds with a test key that lives outside the
// repository (scripts/build-test-apk.mjs, `npm run apk:test`; docs/TESTING.md B.2).
//
// It does nothing unless MG_LOCAL_SIGNING=1 when `expo prebuild` runs, and never on an EAS build
// server (EAS_BUILD is set there). EAS builds therefore keep the generated project unchanged and are
// signed with the EAS credentials as before.
//
// When it is on, android/app/build.gradle gets:
// - a `release` signing config whose keystore path, alias and passwords are read from the
//   environment when Gradle runs (MG_RELEASE_STORE_FILE, MG_RELEASE_STORE_PASSWORD,
//   MG_RELEASE_KEY_ALIAS, MG_RELEASE_KEY_PASSWORD). No path or password is written into the file.
// - `signingConfig signingConfigs.release` in the `release` build type (the Expo template signs
//   release builds with the debug key).
// - a check that stops a release task with a clear message when MG_RELEASE_STORE_FILE is not set
//   (otherwise the Android Gradle plugin quietly produces an unsigned APK).
//
// The edit is idempotent and fails with a clear error when the template no longer has the blocks
// it expects. Unit tests run it on a real generated build.gradle (plugins/__tests__/fixtures).
const { withAppBuildGradle } = require('expo/config-plugins');

const PLUGIN = 'withLocalReleaseSigning';
const TAG = 'mg-local-release-signing';

/** Environment variables read by the generated Gradle code (set by scripts/build-test-apk.mjs). */
const SIGNING_ENV = Object.freeze({
  storeFile: 'MG_RELEASE_STORE_FILE',
  storePassword: 'MG_RELEASE_STORE_PASSWORD',
  keyAlias: 'MG_RELEASE_KEY_ALIAS',
  keyPassword: 'MG_RELEASE_KEY_PASSWORD',
});

/** On only for an explicit local prebuild; never on EAS build servers. Exported for tests. */
function isLocalSigningEnabled(env = process.env) {
  const onEasBuild = /^(1|true)$/i.test(String(env.EAS_BUILD ?? '').trim());
  return env.MG_LOCAL_SIGNING === '1' && !onEasBuild;
}

// --- Minimal Groovy scanner: finds `name { ... }` blocks, skipping strings and comments. ---------

/** If a string literal or comment starts at `i`, returns the index just after it; otherwise `i`. */
function skipLiteral(text, i) {
  const c = text[i];
  if (c === '/' && text[i + 1] === '/') {
    const newline = text.indexOf('\n', i);
    return newline === -1 ? text.length : newline;
  }
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (c === "'" || c === '"') {
    const quote = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
    let j = i + quote.length;
    while (j < text.length) {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text.startsWith(quote, j)) return j + quote.length;
      if (quote.length === 1 && text[j] === '\n') return j;
      j += 1;
    }
    return text.length;
  }
  return i;
}

/** Index of the `}` that closes the `{` at `open`, or -1. */
function matchBrace(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const next = skipLiteral(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Finds the block `name { ... }` that is a direct child of the range [from, to) (not nested deeper).
 * Returns { start, open, close } (indexes of the name, `{` and `}`) or null.
 */
function findChildBlock(text, from, to, name) {
  const header = new RegExp(`${name}\\s*\\{`, 'y');
  let depth = 0;
  let i = from;
  while (i < to) {
    const next = skipLiteral(text, i);
    if (next !== i) {
      i = next;
      continue;
    }
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (depth === 0 && (i === 0 || !/[\w$.]/.test(text[i - 1]))) {
      header.lastIndex = i;
      if (header.test(text)) {
        const open = header.lastIndex - 1;
        const close = matchBrace(text, open);
        if (close === -1 || close > to) return null;
        return { start: i, open, close };
      }
    }
    i += 1;
  }
  return null;
}

function lineStart(text, index) {
  return text.lastIndexOf('\n', index - 1) + 1;
}

function indentOf(text, index) {
  return /^[ \t]*/.exec(text.slice(lineStart(text, index)))[0];
}

function requireBlock(block, what) {
  if (!block) {
    throw new Error(
      `[${PLUGIN}] Could not find ${what} in android/app/build.gradle. The Expo template changed: ` +
        'update plugins/withLocalReleaseSigning.js (and its test fixture).',
    );
  }
  return block;
}

function androidBlock(text) {
  return requireBlock(findChildBlock(text, 0, text.length, 'android'), 'the top-level "android { }" block');
}

// --- The three edits (each one is skipped when already applied) ----------------------------------

const ENV_BEGIN = `// @generated begin ${TAG}-env`;
const CONFIG_BEGIN = `// @generated begin ${TAG}-config`;

function envBlock(eol) {
  return [
    `${ENV_BEGIN} (plugins/withLocalReleaseSigning.js, MG_LOCAL_SIGNING=1)`,
    '// Local test builds only (npm run apk:test). The keystore path and passwords come from the',
    '// environment when Gradle runs; they are never written into this file.',
    `def mgReleaseStoreFile = System.getenv('${SIGNING_ENV.storeFile}') ?: ''`,
    "if (!mgReleaseStoreFile && gradle.startParameter.taskNames.any { it.toLowerCase().contains('release') }) {",
    `    throw new GradleException('Release signing needs ${SIGNING_ENV.storeFile}, ${SIGNING_ENV.storePassword}, ' +`,
    `        '${SIGNING_ENV.keyAlias} and ${SIGNING_ENV.keyPassword}. Build the test APK with \`npm run apk:test\` (scripts/build-test-apk.mjs).')`,
    '}',
    `// @generated end ${TAG}-env`,
    '',
  ].join(eol);
}

function releaseSigningConfig(indent, eol) {
  const body = `${indent}    `;
  return [
    `${indent}${CONFIG_BEGIN} (plugins/withLocalReleaseSigning.js)`,
    `${indent}release {`,
    `${body}if (mgReleaseStoreFile) {`,
    `${body}    storeFile file(mgReleaseStoreFile)`,
    `${body}    storePassword System.getenv('${SIGNING_ENV.storePassword}')`,
    `${body}    keyAlias System.getenv('${SIGNING_ENV.keyAlias}')`,
    `${body}    keyPassword System.getenv('${SIGNING_ENV.keyPassword}')`,
    `${body}}`,
    `${indent}}`,
    `${indent}// @generated end ${TAG}-config`,
  ].join(eol);
}

/** 1. Top-level variable + missing-environment check, right before `android {`. */
function addEnvBlock(text, eol) {
  if (text.includes(ENV_BEGIN)) return text;
  const android = androidBlock(text);
  const at = lineStart(text, android.start);
  return text.slice(0, at) + envBlock(eol) + eol + text.slice(at);
}

/** 2. `signingConfigs { release { ... } }` read from the environment. */
function addSigningConfig(text, eol) {
  if (text.includes(CONFIG_BEGIN)) return text;
  const android = androidBlock(text);
  const signingConfigs = requireBlock(
    findChildBlock(text, android.open + 1, android.close, 'signingConfigs'),
    'the "signingConfigs { }" block inside "android { }"',
  );
  if (findChildBlock(text, signingConfigs.open + 1, signingConfigs.close, 'release')) {
    throw new Error(
      `[${PLUGIN}] android/app/build.gradle already has a "release" signing config that this plugin did not ` +
        'add. Remove it or update plugins/withLocalReleaseSigning.js.',
    );
  }
  const indent = `${indentOf(text, signingConfigs.start)}    `;
  const closeLine = lineStart(text, signingConfigs.close);
  const closeOnOwnLine = text.slice(closeLine, signingConfigs.close).trim() === '';
  const insertion = releaseSigningConfig(indent, eol);
  return closeOnOwnLine
    ? text.slice(0, closeLine) + insertion + eol + text.slice(closeLine)
    : text.slice(0, signingConfigs.close) + eol + insertion + eol + text.slice(signingConfigs.close);
}

/** 3. The `release` build type uses signingConfigs.release. */
function signReleaseBuildTypeWithReleaseConfig(text, eol) {
  const android = androidBlock(text);
  const buildTypes = requireBlock(
    findChildBlock(text, android.open + 1, android.close, 'buildTypes'),
    'the "buildTypes { }" block inside "android { }"',
  );
  const release = requireBlock(
    findChildBlock(text, buildTypes.open + 1, buildTypes.close, 'release'),
    'the "release { }" build type inside "buildTypes { }"',
  );
  const body = text.slice(release.open + 1, release.close);
  // `signingConfig signingConfigs.x` or `signingConfig = signingConfigs.x` on its own line (LF or CRLF).
  const signingLine = /^([ \t]*)signingConfig([ \t]*=[ \t]*|[ \t]+)signingConfigs\.(\w+)[ \t]*(?=\r?$)/gm;
  const found = [...body.matchAll(signingLine)];
  if (found.length > 0 && found.every((match) => match[3] === 'release')) return text;

  let nextBody;
  if (found.length > 0) {
    nextBody = body.replace(
      signingLine,
      (_line, indent, _assign, name) =>
        name === 'release'
          ? `${indent}signingConfig signingConfigs.release`
          : `${indent}// @generated ${TAG}: signed with the local test key (was signingConfigs.${name})${eol}` +
            `${indent}signingConfig signingConfigs.release`,
    );
  } else {
    const indent = `${indentOf(text, release.start)}    `;
    nextBody = `${eol}${indent}// @generated ${TAG}: signed with the local test key${eol}${indent}signingConfig signingConfigs.release${body}`;
  }
  return text.slice(0, release.open + 1) + nextBody + text.slice(release.close);
}

/**
 * Pure transform of android/app/build.gradle (Groovy). Idempotent. Keeps the file's line endings.
 * Throws a clear error when an expected block is missing. Exported for tests.
 */
function addLocalReleaseSigning(buildGradle) {
  const eol = buildGradle.includes('\r\n') ? '\r\n' : '\n';
  let text = signReleaseBuildTypeWithReleaseConfig(buildGradle, eol);
  text = addSigningConfig(text, eol);
  text = addEnvBlock(text, eol);
  return text;
}

function withLocalReleaseSigning(config) {
  if (!isLocalSigningEnabled()) return config;
  return withAppBuildGradle(config, (next) => {
    if (next.modResults.language !== 'groovy') {
      throw new Error(`[${PLUGIN}] Only a Groovy android/app/build.gradle is supported (got ${next.modResults.language}).`);
    }
    next.modResults.contents = addLocalReleaseSigning(next.modResults.contents);
    return next;
  });
}

module.exports = withLocalReleaseSigning;
module.exports.SIGNING_ENV = SIGNING_ENV;
module.exports.isLocalSigningEnabled = isLocalSigningEnabled;
module.exports.addLocalReleaseSigning = addLocalReleaseSigning;
