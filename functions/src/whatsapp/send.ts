/**
 * WhatsApp Cloud API sender (POST graph.facebook.com/<ver>/<phone_number_id>/messages).
 *
 * The bot ONLY replies to inbound messages, so every send is inside Meta's 24 hour customer
 * service window and free-form messages are always allowed (no templates needed). Failures are
 * LOG AND DROP by design (docs/v1/ARCHITECTURE.md §27): the webhook never retries a send, because
 * Meta redelivers the inbound event on a non-200 and a retry loop could storm the user.
 * Logs carry status codes and ids only - never message text or phone numbers (phoneLogId only).
 */
import { WHATSAPP_TUNING } from '../config';

/** WhatsApp caps: 4096 chars for a text body, 1024 for an interactive body, 20 per button title. */
export const MAX_TEXT_CHARS = 4000;
export const MAX_INTERACTIVE_BODY_CHARS = 1000;
export const MAX_BUTTON_TITLE_CHARS = 20;
/** Interactive reply-button messages allow at most 3 buttons. */
export const MAX_BUTTONS = 3;

export interface WhatsappButton {
  /** Comes back as interactive.button_reply.id (max 256 chars). */
  id: string;
  title: string;
}

export interface WhatsappSender {
  sendText(toPhoneE164: string, body: string): Promise<void>;
  sendButtons(toPhoneE164: string, body: string, buttons: readonly WhatsappButton[]): Promise<void>;
}

/** A failed Graph call (never carries message content or phone numbers). */
export class WhatsappApiError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'WhatsappApiError';
  }
}

export interface GraphSenderConfig {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string;
  timeoutMs?: number;
  /** Test seam; global fetch (Node 22) by default. */
  fetchImpl?: typeof fetch;
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function createGraphSender(config: GraphSenderConfig): WhatsappSender {
  const version = config.graphVersion ?? WHATSAPP_TUNING.graphVersion;
  const timeoutMs = config.timeoutMs ?? WHATSAPP_TUNING.graphRequestTimeoutMs;
  const doFetch = config.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`;

  async function post(payload: Record<string, unknown>): Promise<void> {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new WhatsappApiError(null, error instanceof Error ? error.name : 'fetch_failed');
    }
    if (!response.ok) {
      // Drain the body (connection reuse) but never log it: Graph error bodies echo the payload.
      await response.text().catch(() => '');
      throw new WhatsappApiError(response.status, `Graph send failed (${response.status})`);
    }
  }

  return {
    async sendText(toPhoneE164, body) {
      await post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhoneE164,
        type: 'text',
        text: { preview_url: false, body: truncate(body, MAX_TEXT_CHARS) },
      });
    },
    async sendButtons(toPhoneE164, body, buttons) {
      await post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhoneE164,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: truncate(body, MAX_INTERACTIVE_BODY_CHARS) },
          action: {
            buttons: buttons.slice(0, MAX_BUTTONS).map((button) => ({
              type: 'reply',
              reply: { id: button.id, title: truncate(button.title, MAX_BUTTON_TITLE_CHARS) },
            })),
          },
        },
      });
    },
  };
}
