/**
 * WhatsApp Cloud API sender (POST graph.facebook.com/<ver>/<phone_number_id>/messages).
 *
 * The bot's replies are inside Meta's 24 hour customer service window, where free-form messages
 * are allowed. M13 adds the messages the bot starts by itself (whatsapp/outbound.ts): those go
 * out as approved templates (sendTemplate), or in preview mode as ordinary messages. Failures are
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

/** M13: a template message (the names, languages and values of whatsapp/templates.ts). */
export interface TemplateMessage {
  name: string;
  language: string;
  params: readonly string[];
  /** One quick-reply payload per button index. */
  payloads: readonly string[];
}

/** M13: the sends of the bot-started messages; each returns the Cloud API message id (wamid). */
export interface OutboundSender {
  sendTemplate(toPhoneE164: string, template: TemplateMessage): Promise<string | null>;
  sendTextWithId(toPhoneE164: string, body: string): Promise<string | null>;
  sendButtonsWithId(toPhoneE164: string, body: string, buttons: readonly WhatsappButton[]): Promise<string | null>;
}

/** A failed Graph call (never carries message content or phone numbers). */
export class WhatsappApiError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
    /** Meta's error.code (131047 window closed, 132001 language, 132015 paused, ...), when given. */
    readonly code: number | null = null,
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

export function createGraphSender(config: GraphSenderConfig): WhatsappSender & OutboundSender {
  const version = config.graphVersion ?? WHATSAPP_TUNING.graphVersion;
  const timeoutMs = config.timeoutMs ?? WHATSAPP_TUNING.graphRequestTimeoutMs;
  const doFetch = config.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`;

  async function post(payload: Record<string, unknown>): Promise<string | null> {
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
      // Never log the body: Graph error bodies echo the payload. Only Meta's numeric code is kept.
      const raw = await response.text().catch(() => '');
      let code: number | null = null;
      try {
        const parsed = JSON.parse(raw) as { error?: { code?: unknown } };
        code = typeof parsed.error?.code === 'number' ? parsed.error.code : null;
      } catch {
        code = null;
      }
      throw new WhatsappApiError(response.status, `Graph send failed (${response.status})`, code);
    }
    const body = (await response.json().catch(() => null)) as { messages?: { id?: unknown }[] } | null;
    const id = body?.messages?.[0]?.id;
    return typeof id === 'string' ? id : null;
  }

  function textPayload(to: string, body: string): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: truncate(body, MAX_TEXT_CHARS) },
    };
  }

  function buttonsPayload(to: string, body: string, buttons: readonly WhatsappButton[]): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
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
    };
  }

  return {
    async sendText(toPhoneE164, body) {
      await post(textPayload(toPhoneE164, body));
    },
    async sendButtons(toPhoneE164, body, buttons) {
      await post(buttonsPayload(toPhoneE164, body, buttons));
    },
    sendTextWithId(toPhoneE164, body) {
      return post(textPayload(toPhoneE164, body));
    },
    sendButtonsWithId(toPhoneE164, body, buttons) {
      return post(buttonsPayload(toPhoneE164, body, buttons));
    },
    sendTemplate(toPhoneE164, template) {
      const components: Record<string, unknown>[] = [];
      if (template.params.length > 0) {
        components.push({ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text })) });
      }
      template.payloads.forEach((payload, index) => {
        components.push({ type: 'button', sub_type: 'quick_reply', index: String(index), parameters: [{ type: 'payload', payload }] });
      });
      return post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhoneE164,
        type: 'template',
        template: { name: template.name, language: { code: template.language }, components },
      });
    },
  };
}
