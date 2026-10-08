// Builds a release APK for emulator and sideload testing, signed with a local TEST key
// (docs/TESTING.md B.2 "Emulator testing (no real phone)").
//
//   npm run apk:sha1                    create the test key if needed and print its SHA-1 / SHA-256
//   npm run apk:test [-- --out <dir>]   build <dir>/MeetingGuardAI-<version>-test.apk
//
// What `apk:test` does:
//   1. Checks Java (JAVA_HOME, a JDK in %LOCALAPPDATA%\Android\jdk-17*, or the JDK bundled with
//      Android Studio), the Android SDK and the app's .env files.
//      Only key names are printed, never values; secret-looking entries stop the build.
//   2. Creates the test key once, outside the repository: %USERPROFILE%\.meetingguard\
//      test-release.keystore (PKCS12, alias mgtest) with a random password stored next to it in
//      test-release.properties. The password is never printed or passed on a command line.
//   3. Regenerates android/ with MG_LOCAL_TEST_BUILD=1 (EAS Update off, app.config.js) and
//      MG_LOCAL_SIGNING=1 (plugins/withLocalReleaseSigning.js), then runs Gradle assembleRelease for
//      x86_64 (emulators) + arm64-v8a (phones). Gradle gets the signing values as environment variables.
//      On Windows: Java options against VPN socket layers, and the modules' build output on the
//      system drive against busy files (testApk.js buildChildEnv, scripts/gradle/). Gradle runs
//      again (up to 3 times) after a busy file or a stalled download.
//   4. Copies the APK to the output folder and prints its path, size and SHA-256.
// Nothing here runs on EAS or in CI. Pure helpers (with tests): scripts/lib/testApk.js.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const lib = require('./lib/testApk.js');

const { FriendlyError, SIGNING_ENV } = lib;
const PLATFORM = process.platform;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_DIR = path.join(REPO_ROOT, 'android');
const APK_BUILT = path.join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

const out = (line = '') => process.stdout.write(`${line}\n`);
const step = (title) => out(`\n== ${title}`);
const indent = (text) =>
  String(text ?? '')
    .trim()
    .split(/\r?\n/)
    .map((line) => `    ${line}`)
    .join('\n');

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

// --- Checks ---------------------------------------------------------------------------------------

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function findJava() {
  const tried = [];
  for (const candidate of lib.javaHomeCandidates(process.env, PLATFORM, listDirs)) {
    const java = lib.javaTool(candidate.dir, 'java', PLATFORM);
    if (!fs.existsSync(java)) {
      tried.push({ ...candidate, problem: 'not found' });
      continue;
    }
    const result = spawnSync(java, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const major = lib.parseJavaMajorVersion(`${result.stderr ?? ''}\n${result.stdout ?? ''}`);
    if (major === null) {
      tried.push({ ...candidate, problem: '"java -version" did not work' });
    } else if (major < lib.MIN_JAVA_MAJOR) {
      tried.push({ ...candidate, problem: `Java ${major} is too old` });
    } else if (!fs.existsSync(lib.javaTool(candidate.dir, 'keytool', PLATFORM))) {
      tried.push({ ...candidate, problem: 'keytool is missing' });
    } else {
      return { home: candidate.dir, source: candidate.source, major, tried };
    }
  }
  return { home: null, tried };
}

function findAndroidSdk() {
  const tried = [];
  for (const candidate of lib.androidSdkCandidates(process.env, PLATFORM)) {
    if (isDirectory(candidate.dir)) return { dir: candidate.dir, source: candidate.source, tried };
    tried.push({ ...candidate, problem: 'not found' });
  }
  return { dir: null, tried };
}

function checkEnvFiles() {
  const files = lib.RELEASE_ENV_FILES.map((name) => {
    const file = path.join(REPO_ROOT, name);
    return { name, text: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null };
  });
  return lib.checkEnvFiles(files, process.env);
}

// --- Test signing key -----------------------------------------------------------------------------

function runKeytool(keytool, args, key) {
  // The passwords reach keytool only through its environment (-storepass:env / -keypass:env).
  return spawnSync(keytool, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, [SIGNING_ENV.storePassword]: key.storePassword, [SIGNING_ENV.keyPassword]: key.keyPassword },
  });
}

function ensureKeystore(javaHome) {
  const paths = lib.keystorePaths(os.homedir(), PLATFORM);
  const keytool = lib.javaTool(javaHome, 'keytool', PLATFORM);
  fs.mkdirSync(paths.dir, { recursive: true });

  if (fs.existsSync(paths.keystore)) {
    const props = fs.existsSync(paths.properties) ? lib.parseProperties(fs.readFileSync(paths.properties, 'utf8')) : {};
    if (!props.storePassword) {
      throw new FriendlyError(
        [
          `The test key exists (${paths.keystore}) but its password file is missing or empty:`,
          `  ${paths.properties}`,
          '',
          'Restore that file if you have a copy. Otherwise delete the keystore file and run the command again:',
          'a NEW test key is created, and you must register its new SHA-1 in Google Cloud (docs/SETUP.md §4.2).',
        ].join('\n'),
      );
    }
    return {
      ...paths,
      keytool,
      alias: props.keyAlias || lib.KEY_ALIAS,
      storePassword: props.storePassword,
      keyPassword: props.keyPassword || props.storePassword,
      created: false,
    };
  }

  const password = lib.generatePassword();
  const key = { ...paths, keytool, alias: lib.KEY_ALIAS, storePassword: password, keyPassword: password, created: true };
  // Save the password first: a keystore whose password is lost is useless.
  fs.writeFileSync(paths.properties, lib.formatSigningProperties({ alias: key.alias, password }), { encoding: 'utf8', mode: 0o600 });
  const result = runKeytool(keytool, lib.keytoolGenkeyArgs({ keystore: paths.keystore, alias: key.alias }), key);
  if (result.status !== 0 || !fs.existsSync(paths.keystore)) {
    throw new FriendlyError(`keytool could not create the test key (exit code ${result.status}):\n${indent(`${result.stdout}\n${result.stderr}`)}`);
  }
  return key;
}

function printFingerprints(key) {
  const result = runKeytool(key.keytool, lib.keytoolListArgs({ keystore: key.keystore, alias: key.alias }), key);
  const { sha1, sha256 } = lib.parseFingerprints(result.stdout);
  if (result.status !== 0 || !sha1) {
    throw new FriendlyError(
      [
        `keytool could not read the test key ${key.keystore} with the password in ${key.properties}.`,
        indent(`${result.stdout}\n${result.stderr}`),
        '',
        `If the two files no longer match, delete both and run the command again: a NEW key is created and`,
        'you must register its new SHA-1 in Google Cloud (docs/SETUP.md §4.2).',
      ].join('\n'),
    );
  }
  out(`${key.created ? 'Created' : 'Using'} the test signing key: ${key.keystore} (alias ${key.alias})`);
  if (key.created) out(`Its password is saved in ${key.properties}. Keep both files private; never commit them.`);
  out('');
  out(`  SHA-1:   ${sha1}`);
  out(`  SHA-256: ${sha256 ?? '(not shown by keytool)'}`);
  out('');
  out(`Register this SHA-1 in Google Cloud as an Android OAuth client for package ${lib.APP_PACKAGE}`);
  out('(docs/SETUP.md §4.2). Until then, Google sign-in in the test APK fails with DEVELOPER_ERROR.');
}

// --- Build ----------------------------------------------------------------------------------------

/**
 * Runs a command with its output shown as it comes. With `onOutput`, the output is also passed to
 * onOutput(text) (stdout and stderr, in pieces).
 */
function runStreaming(command, args, options, onOutput) {
  return new Promise((resolve, reject) => {
    const spawnOptions = { ...options, stdio: onOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit' };
    // With `shell: true` the whole command is one string (no args array: Node deprecates that, DEP0190).
    const child = args.length > 0 ? spawn(command, args, spawnOptions) : spawn(command, spawnOptions);
    if (onOutput) {
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        onOutput(chunk.toString('utf8'));
      });
      child.stderr.on('data', (chunk) => {
        process.stderr.write(chunk);
        onOutput(chunk.toString('utf8'));
      });
    }
    child.on('error', reject);
    child.on('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function prebuild(env) {
  const expoCli = path.join(path.dirname(require.resolve('expo/package.json', { paths: [REPO_ROOT] })), 'bin', 'cli');
  // Same as `npx expo prebuild ...`, without a shell: runs the project's own Expo CLI with this Node.
  const code = await runStreaming(process.execPath, [expoCli, 'prebuild', '--platform', 'android', '--clean', '--no-install'], {
    cwd: REPO_ROOT,
    env,
  });
  if (code !== 0) {
    throw new FriendlyError(
      [
        `expo prebuild failed (exit code ${code}). The error is above.`,
        'If it says a file is busy or locked: close Android Studio (or any window that has the android',
        'folder open) and run the command again.',
      ].join('\n'),
    );
  }
  const gradleFile = path.join(ANDROID_DIR, 'app', 'build.gradle');
  if (!fs.readFileSync(gradleFile, 'utf8').includes('@generated begin mg-local-release-signing')) {
    throw new FriendlyError(
      'android/app/build.gradle has no local release signing. Is ./plugins/withLocalReleaseSigning still listed in app.config.js?',
    );
  }
}

function writeLocalProperties(sdkDir) {
  const file = path.join(ANDROID_DIR, 'local.properties');
  const next = lib.localPropertiesText(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, sdkDir);
  if (next !== null) fs.writeFileSync(file, next, 'utf8');
}

/** One Gradle run. Resolves to { code, transient } (transient: see lib.TRANSIENT_GRADLE_FAILURES). */
async function runGradleOnce(gradle, env) {
  let transient = false;
  let overlap = '';
  const code = await runStreaming(gradle.command, gradle.args, { cwd: ANDROID_DIR, env, shell: gradle.shell }, (text) => {
    // Keep the end of the previous piece so that a message split between two pieces is still found.
    const window = overlap + text;
    if (!transient && lib.hasTransientGradleFailure(window)) transient = true;
    overlap = window.slice(-1024);
  });
  return { code, transient };
}

async function gradleAssembleRelease(env) {
  const gradle = lib.gradleInvocation(PLATFORM);
  let code = 1;
  for (let attempt = 1; attempt <= lib.GRADLE_ATTEMPTS; attempt += 1) {
    const result = await runGradleOnce(gradle, env);
    code = result.code;
    if (code === 0 || !result.transient || attempt === lib.GRADLE_ATTEMPTS) break;
    out('');
    out('Gradle stopped because another program held a file for a moment (antivirus scanning, for example)');
    out('or a download stalled. Gradle continues where it stopped, so it runs again.');
    step(`Building the release APK again (attempt ${attempt + 1} of ${lib.GRADLE_ATTEMPTS})`);
  }
  if (code !== 0) {
    throw new FriendlyError(
      [
        `Gradle failed (exit code ${code}). Look for "What went wrong:" above. Common causes:`,
        '  - First build: Gradle, the Android build tools and the NDK are downloaded (several GB). Check the',
        '    internet connection and run the command again.',
        '  - SDK licences not accepted: open Android Studio > Settings > Languages & Frameworks > Android SDK',
        '    once (or finish the setup wizard), or run "sdkmanager --licenses" without Android Studio, then',
        '    run the command again.',
        '  - "Filename longer than 260 characters" / path too long: turn on Windows long paths or build from',
        '    a shorter folder (docs/TESTING.md B.2).',
        '  - Out of memory: close other programs; the build needs about 4 GB of free RAM.',
        '  - "being used by another process", "EBUSY" or "deleting depfile": another program (antivirus',
        '    scanning, for example) held a build file each time. Run the command again (docs/TESTING.md B.2).',
      ].join('\n'),
    );
  }
  if (!fs.existsSync(APK_BUILT)) {
    const unsigned = path.join(path.dirname(APK_BUILT), 'app-release-unsigned.apk');
    throw new FriendlyError(
      fs.existsSync(unsigned)
        ? 'Gradle built an UNSIGNED APK: the release signing values did not reach Gradle.'
        : `Gradle finished but ${APK_BUILT} is missing.`,
    );
  }
}

async function sha256Of(file) {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

function resolveOutDir(outArg) {
  if (!outArg) return lib.defaultOutDir(REPO_ROOT, PLATFORM);
  // npm runs scripts from the repository root; a relative --out is relative to where npm was started.
  return path.resolve(process.env.INIT_CWD || process.cwd(), outArg);
}

// --- Main -----------------------------------------------------------------------------------------

async function main() {
  const args = lib.parseCliArgs(process.argv.slice(2));
  if (args.help) {
    out(lib.USAGE);
    return;
  }
  const started = Date.now();
  out(args.sha1Only ? 'MeetingGuard AI: test signing key (SHA-1 only)' : 'MeetingGuard AI: local test APK (release build)');

  step('Checking the tools');
  const problems = [];
  const java = findJava();
  if (java.home) out(`Java ${java.major}: ${java.home} (${java.source})`);
  else problems.push(lib.javaMissingMessage(java.tried));

  let sdk = null;
  let version = null;
  if (!args.sha1Only) {
    sdk = findAndroidSdk();
    if (sdk.dir) {
      out(`Android SDK: ${sdk.dir} (${sdk.source})`);
      if (!isDirectory(path.join(sdk.dir, 'licenses'))) {
        out('Warning: no accepted SDK licences yet. Open Android Studio once and finish the setup wizard,');
        out('or run "sdkmanager --licenses" from the command-line tools (docs/TESTING.md B.2).');
      }
    } else {
      problems.push(lib.sdkMissingMessage(sdk.tried));
    }

    const envReport = checkEnvFiles();
    const envProblems = lib.envProblemsMessage(envReport);
    if (envProblems) {
      problems.push(envProblems);
    } else {
      out(`App settings (${envReport.found.join(', ') || 'shell environment'}): all ${lib.REQUIRED_ENV_KEYS.length} required values are set.`);
      for (const key of envReport.warnings) {
        out(`Warning: ${key} is empty, so the app uses us-central1. It must match the region of the deployed functions.`);
      }
    }

    version = require(path.join(REPO_ROOT, 'app.config.js')).expo.version;
    lib.apkFileName(version);
  }
  if (problems.length > 0) throw new FriendlyError(problems.join('\n\n'));

  step('Test signing key');
  const key = ensureKeystore(java.home);
  printFingerprints(key);
  if (args.sha1Only) return;

  const env = lib.buildChildEnv({
    baseEnv: process.env,
    platform: PLATFORM,
    javaHome: java.home,
    androidHome: sdk.dir,
    keystore: key.keystore,
    alias: key.alias,
    storePassword: key.storePassword,
    keyPassword: key.keyPassword,
  });

  step('Generating the Android project (expo prebuild --platform android --clean)');
  await prebuild(env);
  writeLocalProperties(sdk.dir);

  step(`Building the release APK for ${lib.ARCHITECTURES.join(' + ')} (the first build can take 20-40 minutes)`);
  await gradleAssembleRelease(env);

  step('Delivering the APK');
  const outDir = resolveOutDir(args.out);
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, lib.apkFileName(version));
  fs.copyFileSync(APK_BUILT, target);
  const size = fs.statSync(target).size;
  const adb = lib.adbPath(sdk.dir, PLATFORM);

  out(`Test APK: ${target}`);
  out(`  Size:    ${lib.formatBytes(size)}`);
  out(`  SHA-256: ${await sha256Of(target)}`);
  out(`  Version: ${version}, signed with the test key (SHA-1 above), EAS Update off`);
  out(`  Built in ${lib.formatDuration(Date.now() - started)}`);
  out('');
  out('Install it on a running emulator:');
  out('  - drag the APK file onto the emulator window, or');
  out(`  - adb install -r "${target}"`);
  out(`    (adb is ${adb}${fs.existsSync(adb) ? '' : ', not installed yet: Android Studio > SDK Manager > SDK Tools > Platform-Tools'})`);
  out(`If a build signed with another key (EAS, Google Play) is installed, remove it first: adb uninstall ${lib.APP_PACKAGE}`);
  out('Test plan and emulator setup: docs/TESTING.md B.2.');
}

main().catch((error) => {
  if (error instanceof FriendlyError) {
    process.stderr.write(`\n${error.message}\n`);
  } else {
    process.stderr.write(`\nUnexpected error: ${error?.stack ?? error}\n`);
  }
  process.exitCode = 1;
});
