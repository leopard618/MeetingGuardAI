/**
 * MATTERS area public API: the executive assistant's matters (prototype, A1;
 * docs/v1/ARCHITECTURE.md section 36). Switched off unless EXPO_PUBLIC_MATTERS_ENABLED.
 */
export { matterService, createMatterService, mapMatterError } from './matterService';
export type { MatterService, MatterTransport } from './matterService';
