// Pure helpers for scripts/build-test-apk.mjs (local test APK for emulators; docs/v1/TESTING.md B.2).
// No file system or process access here, so everything is unit tested
// (scripts/lib/__tests__/testApk.test.js) and behaves the same on Windows, macOS and Linux (CI).
const crypto = require('node:crypto');
const path = require('node:path');
const util = require('node:util');

const { SIGNING_ENV } = require('../../plugins/withLocalReleaseSigning');

const APP_PACKAGE = 'com.meetingguard.ai';
const KEY_ALIAS = 'mgtest';
const KEY_DNAME = 'CN=MeetingGuard Test';
// 25 years, leap days included.
const KEY_VALIDITY_DAYS = 25 * 365 + 7;
// x86_64 for emulators on a PC, arm64-v8a for real phones.
const ARCHITECTURES = ['x86_64', 'arm64-v8a'];
// Android Gradle plugin 8+ needs JDK 17 or newer (Android Studio ships JDK 21 as "jbr").
const MIN_JAVA_MAJOR = 17;

// Keys the app cannot start without on Android (src/config/env.ts requiredKeysFor('android')).
const REQUIRED_ENV_KEYS = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
];
// Optional, but a wrong or missing region breaks the assistant (the default is us-central1).
const RECOMMENDED_ENV_KEYS = ['EXPO_PUBLIC_FUNCTIONS_REGION'];

// The files Expo CLI reads when Gradle bundles a release build (NODE_ENV=production), highest
// priority first (@expo/env). A variable already set in the shell wins over all of them.
const RELEASE_ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env'];

// Key names that must never be in the app's .env files, and values that look like secrets (the
// same patterns as the CI bundle scan in .github/workflows/ci.yml, plus PEM private keys).
const SECRET_KEY_PATTERNS = [/OPENAI_API_KEY/i, /SECRET/i, /SERVICE_ROLE/i, /PRIVATE_KEY/i];
const SECRET_VALUE_PATTERN =
  /(^|[^A-Za-z])sk-(proj-)?[A-Za-z0-9_-]{20,}|T3BlbkFJ|GOCSPX|service_role|whsec_|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const USAGE = [
  'Usage:',
  '  npm run apk:test                 build the test APK (release build, signed with the local test key)',
  '  npm run apk:test -- --out <dir>  ...and copy it to <dir> (default: ../deliver next to the repository)',
  '  npm run apk:sha1                 only create the test key if needed and print its SHA-1 / SHA-256',
  '',
  'Direct: node scripts/build-test-apk.mjs [--sha1-only] [--out <dir>] [--help]',
  'Guide: docs/v1/TESTING.md, section B.2 "Emulator testing (no real phone)".',
].join('\n');

/** An error whose message is meant for the person running the script (printed without a stack). */
class FriendlyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FriendlyError';
  }
}

const pathFor = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const isBlank = (value) => typeof value !== 'string' || value.trim() === '';

// --- Command line ---------------------------------------------------------------------------------

/** Parses the script's arguments. Throws FriendlyError (with the usage) for anything unknown. */
function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = util.parseArgs({
      args: argv,
      options: {
        'sha1-only': { type: 'boolean', default: false },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    });
  } catch (error) {
    throw new FriendlyError(`${error.message}\n\n${USAGE}`);
  }
  const { values } = parsed;
  if (values.out !== undefined && values.out.trim() === '') {
    throw new FriendlyError(`--out needs a folder.\n\n${USAGE}`);
  }
  return { sha1Only: values['sha1-only'], out: values.out, help: values.help };
}

// --- Java and the Android SDK ---------------------------------------------------------------------

/** %LOCALAPPDATA%, or %USERPROFILE%\AppData\Local when it is not set (Windows). */
function windowsLocalAppData(env) {
  if (!isBlank(env.LOCALAPPDATA)) return env.LOCALAPPDATA.trim();
  return path.win32.join(isBlank(env.USERPROFILE) ? 'C:\\Users\\Default' : env.USERPROFILE.trim(), 'AppData', 'Local');
}

// A JDK unpacked by hand next to the Android SDK, without Android Studio (docs/v1/TESTING.md B.2):
// %LOCALAPPDATA%\Android\jdk-17, jdk-17.0.20.1+1, jdk-21, ...
const USER_JDK_DIR = /^jdk-(?:17|21)(?:\D|$)/i;
const newestNameFirst = (a, b) => b.localeCompare(a, 'en', { numeric: true, sensitivity: 'base' });

/**
 * Where to look for a JDK, in order: JAVA_HOME, a JDK 17 / 21 in %LOCALAPPDATA%\Android (folders
 * named jdk-17* or jdk-21*, newest first; Windows), then the JDK bundled with Android Studio.
 *
 * @param listDirs (dir) => the names of the folders in `dir` ([] when it does not exist). Passed in
 *   by the caller so this module stays free of file system access.
 */
function javaHomeCandidates(env, platform, listDirs = () => []) {
  const candidates = [];
  if (!isBlank(env.JAVA_HOME)) candidates.push({ source: 'JAVA_HOME', dir: env.JAVA_HOME.trim() });
  if (platform === 'win32') {
    const androidDir = path.win32.join(windowsLocalAppData(env), 'Android');
    const userJdks = listDirs(androidDir)
      .filter((name) => USER_JDK_DIR.test(name))
      .sort(newestNameFirst);
    for (const name of userJdks) candidates.push({ source: 'user-installed JDK', dir: path.win32.join(androidDir, name) });
    const programFiles = isBlank(env.ProgramFiles) ? 'C:\\Program Files' : env.ProgramFiles.trim();
    candidates.push({ source: 'Android Studio', dir: path.win32.join(programFiles, 'Android', 'Android Studio', 'jbr') });
  } else if (platform === 'darwin') {
    candidates.push({ source: 'Android Studio', dir: '/Applications/Android Studio.app/Contents/jbr/Contents/Home' });
  } else {
    candidates.push({ source: 'Android Studio', dir: '/opt/android-studio/jbr' });
  }
  return candidates;
}

/** Where to look for the Android SDK, in order: ANDROID_HOME, ANDROID_SDK_ROOT, Android Studio's default. */
function androidSdkCandidates(env, platform) {
  const p = pathFor(platform);
  const candidates = [];
  if (!isBlank(env.ANDROID_HOME)) candidates.push({ source: 'ANDROID_HOME', dir: env.ANDROID_HOME.trim() });
  if (!isBlank(env.ANDROID_SDK_ROOT)) candidates.push({ source: 'ANDROID_SDK_ROOT', dir: env.ANDROID_SDK_ROOT.trim() });
  if (platform === 'win32') {
    candidates.push({ source: 'Android Studio default', dir: p.join(windowsLocalAppData(env), 'Android', 'Sdk') });
  } else if (!isBlank(env.HOME)) {
    const sdk = platform === 'darwin' ? p.join(env.HOME, 'Library', 'Android', 'sdk') : p.join(env.HOME, 'Android', 'Sdk');
    candidates.push({ source: 'Android Studio default', dir: sdk });
  }
  return candidates;
}

/** <javaHome>/bin/<tool>(.exe) */
function javaTool(javaHome, tool, platform) {
  return pathFor(platform).join(javaHome, 'bin', platform === 'win32' ? `${tool}.exe` : tool);
}

/** <sdk>/platform-tools/adb(.exe) */
function adbPath(androidHome, platform) {
  return pathFor(platform).join(androidHome, 'platform-tools', platform === 'win32' ? 'adb.exe' : 'adb');
}

/** Major version from `java -version` output ("1.8.0_402" -> 8, "21.0.8" -> 21), or null. */
function parseJavaMajorVersion(output) {
  const match = /version "(\d+)(?:\.(\d+))?/.exec(output ?? '');
  if (!match) return null;
  const major = Number(match[1]);
  return major === 1 && match[2] !== undefined ? Number(match[2]) : major;
}

function formatTried(tried) {
  return tried.map((item) => `  - ${item.source}: ${item.dir} (${item.problem})`).join('\n');
}

function javaMissingMessage(tried) {
  return [
    `Java (JDK ${MIN_JAVA_MAJOR} or newer) was not found. The build needs the Java that comes with Android Studio.`,
    '',
    'To fix it:',
    '  1. Install Android Studio from https://developer.android.com/studio (keep the default options).',
    '  2. Open it once and finish the setup wizard (it also downloads the Android SDK).',
    '  3. Run this command again in a NEW terminal window.',
    '',
    'Without Android Studio: unpack a JDK 17 (for example Eclipse Temurin 17) into',
    '%LOCALAPPDATA%\\Android\\jdk-17 so that jdk-17\\bin\\java.exe exists (docs/v1/TESTING.md B.2).',
    '',
    'Looked in:',
    formatTried(tried),
    '',
    `If a JDK ${MIN_JAVA_MAJOR}+ is installed somewhere else, set JAVA_HOME to its folder and try again.`,
  ].join('\n');
}

function sdkMissingMessage(tried) {
  return [
    'The Android SDK was not found.',
    '',
    'To fix it:',
    '  1. Install Android Studio from https://developer.android.com/studio (keep the default options).',
    '  2. Open it once and finish the setup wizard: it downloads the Android SDK to its default folder.',
    '  3. Run this command again in a NEW terminal window.',
    '',
    'Without Android Studio: install the Android command-line tools into %LOCALAPPDATA%\\Android\\Sdk',
    'and the SDK packages with sdkmanager (docs/v1/TESTING.md B.2).',
    '',
    'Looked in:',
    tried.length > 0 ? formatTried(tried) : '  (no location to check: set ANDROID_HOME)',
    '',
    'If the SDK is somewhere else, set ANDROID_HOME to its folder and try again.',
  ].join('\n');
}

// --- .env check -----------------------------------------------------------------------------------

/** Parses a .env file exactly like Expo CLI does (node:util parseEnv, keys trimmed). */
function parseDotEnv(text) {
  const parsed = util.parseEnv(text);
  const values = {};
  for (const key of Object.keys(parsed)) values[key.trim()] = parsed[key];
  return values;
}

function isSecretLikeKey(name) {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(name));
}

function hasSecretLikeValue(value) {
  return typeof value === 'string' && SECRET_VALUE_PATTERN.test(value);
}

// With node:util parseEnv (and so in Expo), a line "KEY=" followed only by spaces takes the NEXT line
// as its value: KEY becomes "NEXT_KEY=value" and NEXT_KEY is lost.
const SWALLOWED_LINE = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/;

/**
 * Checks the app's .env files for a release build. Never returns values, only key and file names.
 *
 * @param files [{ name, text }] in RELEASE_ENV_FILES order (highest priority first); text is null
 *   when the file does not exist.
 * @param systemEnv the shell environment (a variable set there wins over the files, like in Expo).
 * @returns { found: string[] (existing files), missing: string[] (required keys without a value),
 *   warnings: string[] (recommended keys without a value), secrets: [{ file, key }],
 *   swallowed: [{ file, key }] (keys whose value is the next line, see SWALLOWED_LINE) }
 */
function checkEnvFiles(files, systemEnv) {
  const existing = files
    .filter((file) => typeof file.text === 'string')
    .map((file) => ({ name: file.name, values: parseDotEnv(file.text) }));
  const merged = {};
  // Lowest priority first, so higher-priority files overwrite.
  for (const file of [...existing].reverse()) Object.assign(merged, file.values);

  const secrets = [];
  const swallowed = [];
  for (const file of existing) {
    for (const [key, value] of Object.entries(file.values)) {
      if (isBlank(value)) continue;
      if (isSecretLikeKey(key) || hasSecretLikeValue(value)) secrets.push({ file: file.name, key });
      if (SWALLOWED_LINE.test(value)) swallowed.push({ file: file.name, key });
    }
  }
  const effective = (key) => (systemEnv[key] !== undefined ? systemEnv[key] : merged[key]);
  return {
    found: existing.map((file) => file.name),
    missing: REQUIRED_ENV_KEYS.filter((key) => isBlank(effective(key))),
    warnings: RECOMMENDED_ENV_KEYS.filter((key) => isBlank(effective(key))),
    secrets,
    swallowed,
  };
}

/** The error text for checkEnvFiles problems (key and file names only), or null when all is fine. */
function envProblemsMessage(report) {
  const parts = [];
  if (report.secrets.length > 0) {
    const list = report.secrets.map((item) => `  - ${item.key} (in ${item.file})`).join('\n');
    parts.push(
      [
        'These entries in your .env files look like SECRETS:',
        list,
        '',
        'Remove them from the file and build again. The app never needs a secret: every EXPO_PUBLIC_* value',
        'is copied into the APK where anyone can read it, and the OpenAI key and the Google client secret',
        'live only in Firebase Functions secrets (docs/v1/SETUP.md §6.2). Keep them in a password manager.',
      ].join('\n'),
    );
  }
  if (report.swallowed.length > 0) {
    parts.push(
      [
        'In these entries the value is the NEXT line of the file:',
        ...report.swallowed.map((item) => `  - ${item.key} (in ${item.file})`),
        '',
        'This happens when a line is "KEY=" followed only by spaces. Delete the spaces after "=" (or give',
        'the key its value), then build again.',
      ].join('\n'),
    );
  }
  if (report.missing.length > 0) {
    const where =
      report.found.length > 0
        ? `(looked in ${report.found.join(', ')} and in the shell environment)`
        : '(there is no .env file in the repository folder)';
    parts.push(
      [
        `These required values are empty or missing ${where}:`,
        ...report.missing.map((key) => `  - ${key}`),
        '',
        'Copy env.example to .env and fill them in (env.example says where each value comes from), or run',
        '`eas env:pull --environment preview`, which writes .env.local. Without them the app only shows',
        '"App not configured".',
      ].join('\n'),
    );
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}

// --- Test signing key -----------------------------------------------------------------------------

/** %USERPROFILE%\.meetingguard\test-release.keystore (+ .properties with the password). */
function keystorePaths(homeDir, platform) {
  const p = pathFor(platform);
  const dir = p.join(homeDir, '.meetingguard');
  return {
    dir,
    keystore: p.join(dir, 'test-release.keystore'),
    properties: p.join(dir, 'test-release.properties'),
  };
}

/** 32 URL-safe characters (192 random bits): safe in .properties files and environment variables. */
function generatePassword(randomBytes = crypto.randomBytes) {
  return randomBytes(24).toString('base64url');
}

function formatSigningProperties({ alias, password }) {
  return [
    '# MeetingGuard AI local TEST signing key (scripts/build-test-apk.mjs, docs/v1/TESTING.md B.2).',
    '# Keep this file and test-release.keystore private and out of any repository. This key signs only',
    '# APKs for emulators and test phones, never a Google Play upload.',
    `keyAlias=${alias}`,
    `storePassword=${password}`,
    `keyPassword=${password}`,
    '',
  ].join('\n');
}

/** Minimal Java .properties reader (key=value lines, # and ! comments). */
function parseProperties(text) {
  const values = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const match = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/** keytool arguments to create the PKCS12 test keystore. Passwords are read from environment variables. */
function keytoolGenkeyArgs({ keystore, alias = KEY_ALIAS }) {
  return [
    '-J-Duser.language=en',
    '-genkeypair',
    '-v',
    '-storetype',
    'PKCS12',
    '-keystore',
    keystore,
    '-alias',
    alias,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    String(KEY_VALIDITY_DAYS),
    '-dname',
    KEY_DNAME,
    '-storepass:env',
    SIGNING_ENV.storePassword,
    '-keypass:env',
    SIGNING_ENV.keyPassword,
    '-noprompt',
  ];
}

/** keytool arguments to print the certificate of the test key (English output, parsed below). */
function keytoolListArgs({ keystore, alias = KEY_ALIAS }) {
  return ['-J-Duser.language=en', '-list', '-v', '-keystore', keystore, '-alias', alias, '-storepass:env', SIGNING_ENV.storePassword];
}

/** SHA-1 and SHA-256 certificate fingerprints from `keytool -list -v` output (null when absent). */
function parseFingerprints(output) {
  const text = String(output ?? '');
  const sha1 = /SHA-?1:\s*((?:[0-9A-F]{2}:){19}[0-9A-F]{2})\b/i.exec(text);
  const sha256 = /SHA-?256:\s*((?:[0-9A-F]{2}:){31}[0-9A-F]{2})\b/i.exec(text);
  return { sha1: sha1 ? sha1[1].toUpperCase() : null, sha256: sha256 ? sha256[1].toUpperCase() : null };
}

// --- Build ----------------------------------------------------------------------------------------

// Java options for every JVM of the build on Windows (Gradle, its daemon and workers, the Kotlin
// daemon), through JAVA_TOOL_OPTIONS. VPN and proxy tools that install a Winsock layered service
// provider (LSP; seen with Astrill VPN's ASProxy64.dll) break Java's socket selectors: the default
// selector of Java 17+ (wepoll) crashes the JVM inside the LSP (EXCEPTION_ACCESS_VIOLATION), and the
// classic select() selector fails with "not a socket" when its wake-up pipe is an AF_UNIX socket.
// So the build uses the classic selector with a TCP loopback wake-up pipe, Java's defaults before
// JDK 16/17: the invalid AF_UNIX temp folder "?" makes Java fall back to TCP for that pipe (nothing
// else in the build uses AF_UNIX sockets). Without an LSP this works just the same.
const WINDOWS_JAVA_TOOL_OPTIONS = Object.freeze([
  '-Djava.nio.channels.spi.SelectorProvider=sun.nio.ch.WindowsSelectorProvider',
  '-Djdk.net.unixdomain.tmpdir=?',
]);

/** JAVA_TOOL_OPTIONS for the build on Windows: the caller's options + WINDOWS_JAVA_TOOL_OPTIONS. */
function windowsJavaToolOptions(existing) {
  const current = isBlank(existing) ? '' : existing.trim();
  // Someone who already chose a selector knows why: keep their options as they are.
  if (current.includes('java.nio.channels.spi.SelectorProvider')) return current;
  return [current, ...WINDOWS_JAVA_TOOL_OPTIONS].filter(Boolean).join(' ');
}

// Gradle init script for Windows: the "build" and ".cxx" folders of every Android module become
// junctions to MG_BUILD_OUTPUT_DIR, so build output is written on the system drive. On a drive where a
// file-system filter (antivirus) holds each new file for a moment, codegen, ninja and AGP fail at
// random when they rename or delete a file they just wrote (details in the script).
const BUILD_OUTPUT_INIT_SCRIPT = path.join(__dirname, '..', 'gradle', 'build-output-dir.init.gradle');

/** %LOCALAPPDATA%\MeetingGuardAI\build-output: where the test build writes its output (Windows). */
function windowsBuildOutputDir(env) {
  return path.win32.join(windowsLocalAppData(env), 'MeetingGuardAI', 'build-output');
}

/** Sets `name` in an env object, replacing any differently-cased copy on Windows (Path vs PATH). */
function setEnvVar(env, name, value, platform) {
  if (platform === 'win32') {
    for (const key of Object.keys(env)) {
      if (key !== name && key.toUpperCase() === name.toUpperCase()) delete env[key];
    }
  }
  env[name] = value;
}

function getEnvVar(env, name, platform) {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * Environment for `expo prebuild` and Gradle: local test build + local signing switches, the signing
 * values the generated build.gradle reads, the JDK first on PATH, the SDK location and, on Windows,
 * the Java options and the build output folder above.
 */
function buildChildEnv({ baseEnv, platform, javaHome, androidHome, keystore, alias, storePassword, keyPassword }) {
  const env = { ...baseEnv };
  const p = pathFor(platform);
  const pathKey = platform === 'win32' ? 'Path' : 'PATH';
  const currentPath = getEnvVar(env, 'PATH', platform) ?? '';
  setEnvVar(env, pathKey, currentPath ? `${p.join(javaHome, 'bin')}${p.delimiter}${currentPath}` : p.join(javaHome, 'bin'), platform);
  setEnvVar(env, 'JAVA_HOME', javaHome, platform);
  if (platform === 'win32') {
    setEnvVar(env, 'JAVA_TOOL_OPTIONS', windowsJavaToolOptions(getEnvVar(env, 'JAVA_TOOL_OPTIONS', platform)), platform);
    setEnvVar(env, 'MG_BUILD_OUTPUT_DIR', windowsBuildOutputDir(env), platform);
  }
  setEnvVar(env, 'ANDROID_HOME', androidHome, platform);
  setEnvVar(env, 'ANDROID_SDK_ROOT', androidHome, platform);
  setEnvVar(env, 'MG_LOCAL_TEST_BUILD', '1', platform);
  setEnvVar(env, 'MG_LOCAL_SIGNING', '1', platform);
  setEnvVar(env, SIGNING_ENV.storeFile, keystore, platform);
  setEnvVar(env, SIGNING_ENV.storePassword, storePassword, platform);
  setEnvVar(env, SIGNING_ENV.keyAlias, alias, platform);
  setEnvVar(env, SIGNING_ENV.keyPassword, keyPassword, platform);
  // A local test build never uploads source maps to Sentry.
  setEnvVar(env, 'SENTRY_DISABLE_AUTO_UPLOAD', 'true', platform);
  return env;
}

/**
 * How to run `gradlew assembleRelease` for x86_64 + arm64-v8a. On Windows a .bat file needs cmd.exe,
 * so it is one command string for `spawn(command, { shell: true })`; the property is quoted because
 * cmd.exe treats commas as separators, and the build output init script is added.
 */
function gradleInvocation(platform, initScript = BUILD_OUTPUT_INIT_SCRIPT) {
  const property = `-PreactNativeArchitectures=${ARCHITECTURES.join(',')}`;
  const tasks = ['assembleRelease', '--no-daemon'];
  if (platform === 'win32') {
    const command = `.\\gradlew.bat ${tasks[0]} "${property}" ${tasks.slice(1).join(' ')} --init-script "${initScript}"`;
    return { command, args: [], shell: true };
  }
  return { command: './gradlew', args: [tasks[0], property, ...tasks.slice(1)], shell: false };
}

// Gradle output that means a file was busy for a moment (a file-system filter such as antivirus
// scanning held a file the build had just written: Java, ninja and Node errors) or that a download
// stalled. Gradle continues where it stopped, so running it again is enough.
const TRANSIENT_GRADLE_FAILURES = Object.freeze([
  /being used by another process/i,
  /EBUSY: resource busy or locked/,
  /deleting depfile: Permission denied/,
  /Read timed out/,
]);
// First run + up to 2 more after a transient failure.
const GRADLE_ATTEMPTS = 3;

/** True when Gradle output contains one of TRANSIENT_GRADLE_FAILURES. */
function hasTransientGradleFailure(output) {
  return TRANSIENT_GRADLE_FAILURES.some((pattern) => pattern.test(String(output ?? '')));
}

/** android/local.properties text with sdk.dir (Java properties escaping), or null when already right. */
function localPropertiesText(existing, sdkDir) {
  const line = `sdk.dir=${sdkDir.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}`;
  const lines = typeof existing === 'string' ? existing.split(/\r?\n/) : [];
  if (lines.includes(line)) return null;
  const kept = lines.filter((item) => !/^\s*sdk\.dir\s*[=:]/.test(item) && item.trim() !== '');
  return [...kept, line, ''].join('\n');
}

function apkFileName(version, when = new Date()) {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(String(version ?? ''))) {
    throw new FriendlyError(`Unexpected app version "${version}" in app.config.js.`);
  }
  // Build-time stamp: every build gets its own file, so a rebuild of the same version never
  // silently replaces the APK a tester already has.
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}`;
  return `MeetingGuardAI-${version}-test-${stamp}.apk`;
}

/** Default output folder: "deliver" next to the repository folder. */
function defaultOutDir(repoRoot, platform) {
  return pathFor(platform).resolve(repoRoot, '..', 'deliver');
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

module.exports = {
  APP_PACKAGE,
  ARCHITECTURES,
  BUILD_OUTPUT_INIT_SCRIPT,
  FriendlyError,
  GRADLE_ATTEMPTS,
  KEY_ALIAS,
  KEY_DNAME,
  KEY_VALIDITY_DAYS,
  MIN_JAVA_MAJOR,
  RECOMMENDED_ENV_KEYS,
  RELEASE_ENV_FILES,
  REQUIRED_ENV_KEYS,
  SIGNING_ENV,
  TRANSIENT_GRADLE_FAILURES,
  USAGE,
  WINDOWS_JAVA_TOOL_OPTIONS,
  adbPath,
  androidSdkCandidates,
  apkFileName,
  buildChildEnv,
  checkEnvFiles,
  defaultOutDir,
  envProblemsMessage,
  formatBytes,
  formatDuration,
  formatSigningProperties,
  generatePassword,
  gradleInvocation,
  hasSecretLikeValue,
  hasTransientGradleFailure,
  isSecretLikeKey,
  javaHomeCandidates,
  javaMissingMessage,
  javaTool,
  keystorePaths,
  keytoolGenkeyArgs,
  keytoolListArgs,
  localPropertiesText,
  parseCliArgs,
  parseDotEnv,
  parseFingerprints,
  parseJavaMajorVersion,
  parseProperties,
  sdkMissingMessage,
};
