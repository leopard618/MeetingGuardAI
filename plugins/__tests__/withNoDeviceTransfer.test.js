const { DATA_EXTRACTION_RULES_XML, setDataExtractionRules } = require('../withNoDeviceTransfer');

describe('withNoDeviceTransfer', () => {
  it('excludes every storage domain from cloud backup and device-to-device transfer', () => {
    const sections = ['cloud-backup', 'device-transfer'].map((tag) => {
      const start = DATA_EXTRACTION_RULES_XML.indexOf(`<${tag}>`);
      const end = DATA_EXTRACTION_RULES_XML.indexOf(`</${tag}>`);
      return start >= 0 && end > start ? DATA_EXTRACTION_RULES_XML.slice(start, end) : '';
    });
    for (const section of sections) {
      for (const domain of ['root', 'file', 'database', 'sharedpref', 'external', 'device_file', 'device_sharedpref']) {
        expect(section).toContain(`<exclude domain="${domain}" path="." />`);
      }
      expect(section).not.toContain('<include');
    }
  });

  it('points the application at the rules and keeps backups off', () => {
    const manifest = {
      manifest: {
        application: [{ $: { 'android:name': '.MainApplication', 'android:fullBackupContent': '@xml/secure_store_backup_rules' } }],
      },
    };
    const application = setDataExtractionRules(manifest).manifest.application[0].$;
    expect(application['android:dataExtractionRules']).toBe('@xml/mg_data_extraction_rules');
    expect(application['android:allowBackup']).toBe('false');
    expect(application['android:fullBackupContent']).toBeUndefined();
  });
});
