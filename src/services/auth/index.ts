/**
 * AUTH area public API (owner: auth) - layer L6 (includes the session manager and React bindings).
 * Lower layers (calendar, ai) import './authService' directly instead of this barrel.
 */
export { authService, registerSessionCleanup, type AuthServiceImpl } from './authService';
export { sessionManager } from './sessionManager';
export { AuthProvider, useAuth, type AuthContextValueImpl, type AuthSimpleResult } from './AuthProvider';
export { authErrorMessageKey, getAuthErrorReason, type AuthErrorReason } from './authErrors';
export type { AuthActionResult } from './legacyView';
export type { SessionCleanupContext, SessionCleanupHook } from './sessionCleanup';
