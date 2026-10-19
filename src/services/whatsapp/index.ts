/**
 * WHATSAPP area public API (owner: whatsapp-app) - layer L5 (uses auth identity; UI hooks on
 * top). Account link to the WhatsApp bot via the whatsapp* callables: docs/v1/ARCHITECTURE.md §27.
 */
export { whatsappService } from './whatsappService';
export { useWhatsAppStatus } from './useWhatsAppStatus';
