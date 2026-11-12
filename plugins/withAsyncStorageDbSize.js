// Raises the Android AsyncStorage SQLite limit (library default 6 MB for the whole database).
// The per-user cache keeps every meeting, note and task document plus the outbox, so a calendar
// user with a few thousand imported occurrences can exceed the default; at that point every
// local write fails with "database or disk is full". 50 MB leaves ample headroom.
// Ref: https://react-native-async-storage.github.io/async-storage/docs/advanced/db_size
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'AsyncStorage_db_size_in_MB';
const VALUE = '50';

module.exports = function withAsyncStorageDbSize(config) {
  return withGradleProperties(config, (mod) => {
    const existing = mod.modResults.find((item) => item.type === 'property' && item.key === KEY);
    if (existing) existing.value = VALUE;
    else mod.modResults.push({ type: 'property', key: KEY, value: VALUE });
    return mod;
  });
};
