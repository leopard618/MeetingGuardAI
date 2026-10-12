const path = require('node:path');

const lib = require('../testApk');

const COMPLETE_ENV = [
  'EXPO_PUBLIC_FIREBASE_API_KEY=AIza-test-value',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=demo.firebaseapp.com',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=demo.appspot.com',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000',
  'EXPO_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:0000',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=000000000000-web.apps.googleusercontent.com',
  'EXPO_PUBLIC_FUNCTIONS_REGION=us-central1',
].join('\n');

/** checkEnvFiles input: only the given files exist (name -> text). */
function envFiles(present) {
  return lib.RELEASE_ENV_FILES.map((name) => ({ name, text: present[name] ?? null }));
}

describe('scripts/lib/testApk', () => {
  describe('parseCliArgs', () => {
    it('reads the flags', () => {
      expect(lib.parseCliArgs([])).toEqual({ sha1Only: false, out: undefined, help: false });
      expect(lib.parseCliArgs(['--sha1-only'])).toMatchObject({ sha1Only: true });
      expect(lib.parseCliArgs(['--out', 'D:\\My Builds'])).toMatchObject({ out: 'D:\\My Builds' });
      expect(lib.parseCliArgs(['-h'])).toMatchObject({ help: true });
    });

    it('rejects unknown options and an empty --out with the usage', () => {
      expect(() => lib.parseCliArgs(['--sha1'])).toThrow(lib.FriendlyError);
      expect(() => lib.parseCliArgs(['--sha1'])).toThrow(/Usage:/);
      expect(() => lib.parseCliArgs(['extra'])).toThrow(lib.FriendlyError);
      expect(() => lib.parseCliArgs(['--out', ' '])).toThrow(/--out needs a folder/);
    });
  });

  describe('Java and SDK discovery', () => {
    it('looks for Java in JAVA_HOME, then in Android Studio (Windows default path)', () => {
      expect(lib.javaHomeCandidates({ ProgramFiles: 'C:\\Program Files' }, 'win32')).toEqual([
        { source: 'Android Studio', dir: 'C:\\Program Files\\Android\\Android Studio\\jbr' },
      ]);
      expect(lib.javaHomeCandidates({ JAVA_HOME: 'D:\\jdk-21 ' }, 'win32')).toEqual([
        { source: 'JAVA_HOME', dir: 'D:\\jdk-21' },
        { source: 'Android Studio', dir: 'C:\\Program Files\\Android\\Android Studio\\jbr' },
      ]);
    });

    it('then in a JDK 17 / 21 unpacked into %LOCALAPPDATA%\\Android (no Android Studio), newest first', () => {
      const listDirs = jest.fn(() => ['Sdk', 'jdk-17', 'jdk-11.0.2', 'jdk-21.0.8+9', 'jdk-17.0.20.1+1', 'jdk-170', 'openjdk-17']);
      const env = { JAVA_HOME: 'D:\\java', LOCALAPPDATA: 'C:\\Users\\Ana Lopez\\AppData\\Local', ProgramFiles: 'C:\\Program Files' };
      const android = 'C:\\Users\\Ana Lopez\\AppData\\Local\\Android';
      expect(lib.javaHomeCandidates(env, 'win32', listDirs)).toEqual([
        { source: 'JAVA_HOME', dir: 'D:\\java' },
        { source: 'user-installed JDK', dir: `${android}\\jdk-21.0.8+9` },
        { source: 'user-installed JDK', dir: `${android}\\jdk-17.0.20.1+1` },
        { source: 'user-installed JDK', dir: `${android}\\jdk-17` },
        { source: 'Android Studio', dir: 'C:\\Program Files\\Android\\Android Studio\\jbr' },
      ]);
      expect(listDirs).toHaveBeenCalledWith(android);
    });

    it('finds the user-installed JDK from USERPROFILE when LOCALAPPDATA is not set, and only on Windows', () => {
      const listDirs = jest.fn(() => ['jdk-17']);
      expect(lib.javaHomeCandidates({ USERPROFILE: 'C:\\Users\\ana' }, 'win32', listDirs)[0]).toEqual({
        source: 'user-installed JDK',
        dir: 'C:\\Users\\ana\\AppData\\Local\\Android\\jdk-17',
      });
      listDirs.mockClear();
      expect(lib.javaHomeCandidates({ HOME: '/home/ana' }, 'linux', listDirs)).toEqual([{ source: 'Android Studio', dir: '/opt/android-studio/jbr' }]);
      expect(listDirs).not.toHaveBeenCalled();
    });

    it('looks for the SDK in ANDROID_HOME, ANDROID_SDK_ROOT, then %LOCALAPPDATA%\\Android\\Sdk', () => {
      expect(lib.androidSdkCandidates({ LOCALAPPDATA: 'C:\\Users\\Ana Lopez\\AppData\\Local' }, 'win32')).toEqual([
        { source: 'Android Studio default', dir: 'C:\\Users\\Ana Lopez\\AppData\\Local\\Android\\Sdk' },
      ]);
      expect(
        lib.androidSdkCandidates({ ANDROID_HOME: 'E:\\sdk', ANDROID_SDK_ROOT: 'F:\\sdk', USERPROFILE: 'C:\\Users\\ana' }, 'win32'),
      ).toEqual([
        { source: 'ANDROID_HOME', dir: 'E:\\sdk' },
        { source: 'ANDROID_SDK_ROOT', dir: 'F:\\sdk' },
        { source: 'Android Studio default', dir: 'C:\\Users\\ana\\AppData\\Local\\Android\\Sdk' },
      ]);
      expect(lib.androidSdkCandidates({ HOME: '/Users/ana' }, 'darwin')).toEqual([
        { source: 'Android Studio default', dir: '/Users/ana/Library/Android/sdk' },
      ]);
    });

    it('builds tool paths', () => {
      expect(lib.javaTool('C:\\Program Files\\Android\\Android Studio\\jbr', 'keytool', 'win32')).toBe(
        'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe',
      );
      expect(lib.javaTool('/opt/jdk', 'java', 'linux')).toBe('/opt/jdk/bin/java');
      expect(lib.adbPath('C:\\sdk', 'win32')).toBe('C:\\sdk\\platform-tools\\adb.exe');
    });

    it('reads the Java major version', () => {
      expect(lib.parseJavaMajorVersion('openjdk version "21.0.8" 2025-07-15\nOpenJDK Runtime Environment')).toBe(21);
      expect(lib.parseJavaMajorVersion('java version "1.8.0_402"')).toBe(8);
      expect(lib.parseJavaMajorVersion('openjdk version "17" 2021-09-14')).toBe(17);
      expect(lib.parseJavaMajorVersion('garbage')).toBeNull();
    });

    it('explains in plain words what to install', () => {
      const tried = [{ source: 'Android Studio', dir: 'C:\\Program Files\\Android\\Android Studio\\jbr', problem: 'not found' }];
      const java = lib.javaMissingMessage(tried);
      expect(java).toContain('Install Android Studio from https://developer.android.com/studio');
      expect(java).toContain('C:\\Program Files\\Android\\Android Studio\\jbr (not found)');
      expect(java).toContain('JAVA_HOME');
      expect(java).toContain('%LOCALAPPDATA%\\Android\\jdk-17');
      expect(lib.sdkMissingMessage([])).toContain('set ANDROID_HOME');
      expect(lib.sdkMissingMessage([])).toContain('sdkmanager');
    });
  });

  describe('checkEnvFiles', () => {
    it('passes a complete .env', () => {
      const report = lib.checkEnvFiles(envFiles({ '.env': COMPLETE_ENV }), {});
      expect(report).toEqual({ found: ['.env'], missing: [], warnings: [], secrets: [], swallowed: [] });
      expect(lib.envProblemsMessage(report)).toBeNull();
    });

    it('lists missing and empty required keys by name only', () => {
      const text = COMPLETE_ENV.replace(/^EXPO_PUBLIC_FIREBASE_APP_ID=.*$/m, 'EXPO_PUBLIC_FIREBASE_APP_ID=').replace(
        /^EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=.*\n/m,
        '',
      );
      const report = lib.checkEnvFiles(envFiles({ '.env': text }), {});
      expect(report.missing).toEqual(['EXPO_PUBLIC_FIREBASE_APP_ID', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID']);
      const message = lib.envProblemsMessage(report);
      expect(message).toContain('  - EXPO_PUBLIC_FIREBASE_APP_ID');
      expect(message).toContain('looked in .env');
      expect(message).not.toContain('AIza-test-value');
      expect(message).not.toContain('demo.firebaseapp.com');
    });

    it('catches "KEY=" + spaces, which makes Expo read the next line as the value', () => {
      const text = COMPLETE_ENV.replace(/^EXPO_PUBLIC_FIREBASE_APP_ID=.*$/m, 'EXPO_PUBLIC_FIREBASE_APP_ID=   ');
      const report = lib.checkEnvFiles(envFiles({ '.env': text }), {});
      expect(report.swallowed).toEqual([{ file: '.env', key: 'EXPO_PUBLIC_FIREBASE_APP_ID' }]);
      expect(report.missing).toEqual(['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID']);
      const message = lib.envProblemsMessage(report);
      expect(message).toContain('the value is the NEXT line');
      expect(message).not.toContain('googleusercontent');
    });

    it('says when there is no .env file at all', () => {
      const report = lib.checkEnvFiles(envFiles({}), {});
      expect(report.found).toEqual([]);
      expect(report.missing).toEqual(lib.REQUIRED_ENV_KEYS);
      expect(lib.envProblemsMessage(report)).toContain('there is no .env file');
    });

    it('warns (without failing) when the functions region is empty', () => {
      const report = lib.checkEnvFiles(envFiles({ '.env': COMPLETE_ENV.replace('=us-central1', '=') }), {});
      expect(report.missing).toEqual([]);
      expect(report.warnings).toEqual(['EXPO_PUBLIC_FUNCTIONS_REGION']);
      expect(lib.envProblemsMessage(report)).toBeNull();
    });

    it('uses Expo priorities: .env.local over .env, the shell over both', () => {
      const local = 'EXPO_PUBLIC_FIREBASE_PROJECT_ID=';
      expect(lib.checkEnvFiles(envFiles({ '.env': COMPLETE_ENV, '.env.local': local }), {}).missing).toEqual([
        'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
      ]);
      const fromShell = lib.checkEnvFiles(envFiles({ '.env': COMPLETE_ENV, '.env.local': local }), {
        EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo',
      });
      expect(fromShell.missing).toEqual([]);
      expect(fromShell.found).toEqual(['.env.local', '.env']);
    });

    it('refuses secrets by key name or by value, and never prints the value', () => {
      const text = [
        COMPLETE_ENV,
        'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123',
        'GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-abcdef',
        'SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi.payload.sig',
        'STRIPE_WEBHOOK_SECRET=whsec_abc',
        'EXPO_PUBLIC_SOMETHING=sk-abcdefghijklmnopqrstuvwxyz',
        'JWT_SECRET=',
      ].join('\n');
      const report = lib.checkEnvFiles(envFiles({ '.env.local': text, '.env': 'OPENAI_API_KEY=x' }), {});
      expect(report.secrets.at(-1)).toEqual({ file: '.env', key: 'OPENAI_API_KEY' });
      // Higher-priority file first; inside a file, parseEnv's key order.
      expect(report.secrets.slice(0, -1).every((item) => item.file === '.env.local')).toBe(true);
      expect(
        report.secrets
          .slice(0, -1)
          .map((item) => item.key)
          .sort(),
      ).toEqual(['EXPO_PUBLIC_SOMETHING', 'GOOGLE_OAUTH_CLIENT_SECRET', 'OPENAI_API_KEY', 'STRIPE_WEBHOOK_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']);
      const message = lib.envProblemsMessage(report);
      expect(message).toContain('look like SECRETS');
      expect(message).toContain('  - OPENAI_API_KEY (in .env.local)');
      for (const value of ['sk-proj-', 'GOCSPX', 'eyJhbGciOi', 'whsec_', 'sk-abc']) expect(message).not.toContain(value);
    });

    it('does not flag the public values of env.example', () => {
      expect(lib.isSecretLikeKey('EXPO_PUBLIC_FIREBASE_API_KEY')).toBe(false);
      expect(lib.isSecretLikeKey('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID')).toBe(false);
      expect(lib.isSecretLikeKey('EXPO_PUBLIC_SENTRY_DSN')).toBe(false);
      expect(lib.hasSecretLikeValue('flask-outline')).toBe(false);
      expect(lib.hasSecretLikeValue('000000000000-web.apps.googleusercontent.com')).toBe(false);
    });
  });

  describe('test signing key', () => {
    it('lives in the user profile, outside the repository', () => {
      expect(lib.keystorePaths('C:\\Users\\Ana Lopez', 'win32')).toEqual({
        dir: 'C:\\Users\\Ana Lopez\\.meetingguard',
        keystore: 'C:\\Users\\Ana Lopez\\.meetingguard\\test-release.keystore',
        properties: 'C:\\Users\\Ana Lopez\\.meetingguard\\test-release.properties',
      });
    });

    it('generates random URL-safe passwords', () => {
      const a = lib.generatePassword();
      expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(lib.generatePassword()).not.toBe(a);
      expect(lib.generatePassword((size) => Buffer.alloc(size, 0xff))).toBe('_'.repeat(32));
    });

    it('stores and reads back the password file', () => {
      const text = lib.formatSigningProperties({ alias: 'mgtest', password: 'p4ss_word-X' });
      expect(lib.parseProperties(text)).toEqual({ keyAlias: 'mgtest', storePassword: 'p4ss_word-X', keyPassword: 'p4ss_word-X' });
      expect(lib.parseProperties('# c\r\n! c\r\nkeyAlias = mgtest\r\n')).toEqual({ keyAlias: 'mgtest' });
    });

    it('creates a 25-year PKCS12 key without putting a password on the command line', () => {
      const args = lib.keytoolGenkeyArgs({ keystore: 'C:\\Users\\Ana Lopez\\.meetingguard\\test-release.keystore' });
      const value = (flag) => args[args.indexOf(flag) + 1];
      expect(value('-storetype')).toBe('PKCS12');
      expect(value('-keystore')).toBe('C:\\Users\\Ana Lopez\\.meetingguard\\test-release.keystore');
      expect(value('-alias')).toBe('mgtest');
      expect(value('-dname')).toBe('CN=MeetingGuard Test');
      expect(Number(value('-validity'))).toBeGreaterThanOrEqual(25 * 365.25);
      expect(value('-storepass:env')).toBe('MG_RELEASE_STORE_PASSWORD');
      expect(value('-keypass:env')).toBe('MG_RELEASE_KEY_PASSWORD');
      expect(args).not.toContain('-storepass');
      expect(lib.keytoolListArgs({ keystore: 'k' })).toEqual(
        expect.arrayContaining(['-list', '-v', '-alias', 'mgtest', '-storepass:env', 'MG_RELEASE_STORE_PASSWORD']),
      );
    });

    it('reads the SHA-1 and SHA-256 fingerprints from keytool output', () => {
      const sha1 = 'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01';
      const sha256 = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':');
      const output = `Alias name: mgtest\nCertificate fingerprints:\n\t SHA1: ${sha1}\n\t SHA256: ${sha256}\nSignature algorithm name: SHA384withRSA\n`;
      expect(lib.parseFingerprints(output)).toEqual({ sha1, sha256 });
      expect(lib.parseFingerprints('nothing')).toEqual({ sha1: null, sha256: null });
    });
  });

  describe('build', () => {
    const base = {
      platform: 'win32',
      javaHome: 'C:\\Program Files\\Android\\Android Studio\\jbr',
      androidHome: 'C:\\Users\\Ana Lopez\\AppData\\Local\\Android\\Sdk',
      keystore: 'C:\\Users\\Ana Lopez\\.meetingguard\\test-release.keystore',
      alias: 'mgtest',
      storePassword: 'store-pw',
      keyPassword: 'key-pw',
    };

    it('sets the build switches, signing values, JDK and SDK for the child processes', () => {
      const env = lib.buildChildEnv({ ...base, baseEnv: { Path: 'C:\\Windows', JAVA_HOME: 'C:\\old-jdk', OTHER: 'x' } });
      expect(env).toMatchObject({
        OTHER: 'x',
        MG_LOCAL_TEST_BUILD: '1',
        MG_LOCAL_SIGNING: '1',
        MG_RELEASE_STORE_FILE: base.keystore,
        MG_RELEASE_STORE_PASSWORD: 'store-pw',
        MG_RELEASE_KEY_ALIAS: 'mgtest',
        MG_RELEASE_KEY_PASSWORD: 'key-pw',
        JAVA_HOME: base.javaHome,
        ANDROID_HOME: base.androidHome,
        SENTRY_DISABLE_AUTO_UPLOAD: 'true',
      });
      // One PATH entry only (Windows keys are case-insensitive), with the JDK first.
      expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['Path']);
      expect(env.Path).toBe('C:\\Program Files\\Android\\Android Studio\\jbr\\bin;C:\\Windows');
    });

    it('on Windows, gives every JVM the classic socket selector with a TCP wake-up pipe (VPN / LSP crash)', () => {
      const selector = '-Djava.nio.channels.spi.SelectorProvider=sun.nio.ch.WindowsSelectorProvider';
      expect(lib.WINDOWS_JAVA_TOOL_OPTIONS).toEqual([selector, '-Djdk.net.unixdomain.tmpdir=?']);
      expect(lib.buildChildEnv({ ...base, baseEnv: {} }).JAVA_TOOL_OPTIONS).toBe(`${selector} -Djdk.net.unixdomain.tmpdir=?`);
      // Keeps the caller's options (any spelling of the name) and adds these after them.
      const env = lib.buildChildEnv({ ...base, baseEnv: { java_tool_options: ' -Xss4m ' } });
      expect(Object.keys(env).filter((key) => key.toUpperCase() === 'JAVA_TOOL_OPTIONS')).toEqual(['JAVA_TOOL_OPTIONS']);
      expect(env.JAVA_TOOL_OPTIONS).toBe(`-Xss4m ${selector} -Djdk.net.unixdomain.tmpdir=?`);
      // A selector chosen by the caller wins.
      const own = '-Djava.nio.channels.spi.SelectorProvider=com.example.Provider';
      expect(lib.buildChildEnv({ ...base, baseEnv: { JAVA_TOOL_OPTIONS: own } }).JAVA_TOOL_OPTIONS).toBe(own);
    });

    it('on Windows, writes the build output to %LOCALAPPDATA%\\MeetingGuardAI\\build-output', () => {
      const env = lib.buildChildEnv({ ...base, baseEnv: { LOCALAPPDATA: 'C:\\Users\\Ana Lopez\\AppData\\Local' } });
      expect(env.MG_BUILD_OUTPUT_DIR).toBe('C:\\Users\\Ana Lopez\\AppData\\Local\\MeetingGuardAI\\build-output');
      expect(lib.buildChildEnv({ ...base, baseEnv: { USERPROFILE: 'C:\\Users\\Bo' } }).MG_BUILD_OUTPUT_DIR).toBe(
        'C:\\Users\\Bo\\AppData\\Local\\MeetingGuardAI\\build-output',
      );
    });

    it('does not change the caller environment', () => {
      const baseEnv = { PATH: '/usr/bin' };
      const env = lib.buildChildEnv({ ...base, platform: 'linux', javaHome: '/opt/jdk', baseEnv });
      expect(baseEnv).toEqual({ PATH: '/usr/bin' });
      expect(env.PATH).toBe('/opt/jdk/bin:/usr/bin');
      expect(env.JAVA_TOOL_OPTIONS).toBeUndefined();
      expect(env.MG_BUILD_OUTPUT_DIR).toBeUndefined();
    });

    it('runs Gradle for x86_64 and arm64-v8a, quoting the list for cmd.exe', () => {
      expect(lib.BUILD_OUTPUT_INIT_SCRIPT).toBe(path.join(__dirname, '..', '..', 'gradle', 'build-output-dir.init.gradle'));
      expect(lib.gradleInvocation('win32')).toEqual({
        command: `.\\gradlew.bat assembleRelease "-PreactNativeArchitectures=x86_64,arm64-v8a" --no-daemon --init-script "${lib.BUILD_OUTPUT_INIT_SCRIPT}"`,
        args: [],
        shell: true,
      });
      expect(lib.gradleInvocation('win32', 'D:\\My Work\\init.gradle').command).toMatch(/ --init-script "D:\\My Work\\init\.gradle"$/);
      expect(lib.gradleInvocation('darwin')).toEqual({
        command: './gradlew',
        args: ['assembleRelease', '-PreactNativeArchitectures=x86_64,arm64-v8a', '--no-daemon'],
        shell: false,
      });
    });

    it('recognises Gradle failures worth another run (busy files, stalled downloads)', () => {
      expect(lib.GRADLE_ATTEMPTS).toBe(3);
      expect(lib.TRANSIENT_GRADLE_FAILURES).toHaveLength(4);
      const transient = [
        '> D:\\x\\build\\intermediates\\verified_library_resources\\release\\verifyReleaseResources\\linked.apk: The process cannot access the file because it is being used by another process',
        "Error: EBUSY: resource busy or locked, rename 'D:\\x\\codegen\\ShadowNodes.h' -> 'D:\\x\\codegen\\jni\\ShadowNodes.h'",
        '  deleting depfile: Permission denied',
        "> Could not get resource 'https://repo.maven.apache.org/maven2/x.aar'.\n            > Read timed out",
      ];
      for (const output of transient) expect(lib.hasTransientGradleFailure(`noise\n${output}\nBUILD FAILED`)).toBe(true);
      expect(lib.hasTransientGradleFailure("e: file:///D:/x/Foo.kt:3:1 Unresolved reference 'bar'.\nBUILD FAILED")).toBe(false);
      expect(lib.hasTransientGradleFailure('')).toBe(false);
      expect(lib.hasTransientGradleFailure(undefined)).toBe(false);
    });

    it('writes sdk.dir to local.properties with Java properties escaping', () => {
      const sdk = 'C:\\Users\\Ana Lopez\\AppData\\Local\\Android\\Sdk';
      const expected = 'sdk.dir=C\\:\\\\Users\\\\Ana Lopez\\\\AppData\\\\Local\\\\Android\\\\Sdk';
      expect(lib.localPropertiesText(null, sdk)).toBe(`${expected}\n`);
      expect(lib.localPropertiesText(`${expected}\n`, sdk)).toBeNull();
      expect(lib.localPropertiesText('sdk.dir=D\\:\\\\old\nfoo=bar\n', sdk)).toBe(`foo=bar\n${expected}\n`);
    });

    it('names the APK after the app version and the build time', () => {
      expect(lib.apkFileName('1.1.0', new Date(2026, 9, 11, 18, 5))).toBe('MeetingGuardAI-1.1.0-test-20261011-1805.apk');
      expect(() => lib.apkFileName('1.1.0/../../x')).toThrow(lib.FriendlyError);
    });

    it('delivers next to the repository by default', () => {
      expect(lib.defaultOutDir('D:\\WorkSpace\\MeetingGuard_2025.7.28\\Codebase', 'win32')).toBe(
        'D:\\WorkSpace\\MeetingGuard_2025.7.28\\deliver',
      );
    });

    it('formats sizes and durations', () => {
      expect(lib.formatBytes(75_000_000)).toBe('71.5 MB');
      expect(lib.formatBytes(2048)).toBe('2.0 KB');
      expect(lib.formatDuration(125_400)).toBe('2 min 5 s');
      expect(lib.formatDuration(9_000)).toBe('9 s');
    });
  });
});
