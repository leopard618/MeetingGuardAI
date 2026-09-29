/**
 * Compat entry point (owner: auth). Stage-3 screens import this file with its `.jsx` extension,
 * so it stays here as a thin re-export of the auth area's React bindings
 * (src/services/auth/AuthProvider.tsx). New code imports from 'src/services/auth'.
 */
export { AuthProvider, useAuth } from '../services/auth';
