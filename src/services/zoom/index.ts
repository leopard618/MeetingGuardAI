/**
 * ZOOM area public API (owner: zoom-app) - layer L5 (uses auth identity + data; UI hooks on top).
 * Server-created Zoom links via the zoom* callables: docs/ARCHITECTURE.md §24.
 */
export { zoomService } from './zoomService';
export { useZoomStatus } from './useZoomStatus';
