/**
 * Unit-test stand-in for `jose` (pulled in by firebase-admin/auth -> jwks-rsa).
 *
 * jose 6 is ESM-only; Node 22 loads it through require(esm) in production, but Jest 29's module
 * system cannot. Unit tests never verify JWTs, so every export throws if it is ever called.
 */
module.exports = new Proxy(
  {},
  {
    get(_target, name) {
      if (name === '__esModule') return false;
      return () => {
        throw new Error(`jose.${String(name)} is not available in unit tests`);
      };
    },
  },
);
