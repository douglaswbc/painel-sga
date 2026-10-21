/**
 * Sending of approved WhatsApp templates through the official Meta Cloud API.
 *
 * The template stored in the SGA uses the creation format (`BODY`, `HEADER`,
 * `BUTTONS` with `{{1}}` placeholders). The Messages API expects the send
 * format (`body`, `header`, `button` with `parameters`), so the components are
 * converted here, keeping the Meta ordering: header, body and buttons.
 */

import { graphJson, MetaApiError } from './meta-graph.ts';

type JsonRecord = Record<string, any>;

export type MetaTemplateSendInput = {
  phoneNumberId: string;
  token: string;
  to: string;
  templateName: string;
  templateLanguage: string;
  templateParams: string[];
  components?: unknown[];
};

/**
 * Brazilian numbers exist in two forms on WhatsApp: with the ninth digit and
 * without it. A number registered before the ninth digit was introduced is
 * still stored without it, even though the business displays it with the
 * ninth digit. Meta only accepts the form registered on the account, so both
 * variants are tried.
 */
export function whatsappNumberVariants(value: string): string[] {
  const digits = String(value ?? '').replace(/\D/g, '');
  const variants = [digits];
  if (digits.startsWith('55') && digits.length === 13) {
    // 55 + DDD + nono digito + 8 digitos -> remove o nono digito.
    variants.push(`${digits.slice(0, 4)}${digits.slice(5)}`);
  } else if (digits.startsWith('55') && digits.length === 12) {
    // 55 + DDD + 8 digitos -> inclui o nono digito.
    variants.push(`${digits.slice(0, 4)}9${digits.slice(4)}`);
  }
  return [...new Set(variants)];
}

function variablesIn(text: unknown): number[] {
  return [...new Set([...String(text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))]
    .sort((a, b) => a - b);
}

/**
 * Converts the template components into the format expected by the Messages
 * API. The parameter order follows the `{{n}}` numbering: header first, then
 * body, then the dynamic URL buttons.
 */
export function buildTemplateComponents(components: JsonRecord[] = [], params: string[] = []): JsonRecord[] {
  const ordered = [
    ...components.filter((component) => String(component.type).toUpperCase() === 'HEADER'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BODY'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BUTTONS'),
  ];
  const result: JsonRecord[] = [];
  let cursor = 0;
  for (const component of ordered) {
    const type = String(component.type).toUpperCase();
    if (type === 'HEADER' || type === 'BODY') {
      const variables = variablesIn(component.text);
      if (!variables.length) continue;
      result.push({
        type: type.toLowerCase(),
        parameters: variables.map(() => {
          const value = typeof params[cursor] === 'string' ? params[cursor] : '';
          cursor += 1;
          return { type: 'text', text: value };
        }),
      });
      continue;
    }
    if (type === 'BUTTONS') {
      const buttons = Array.isArray(component.buttons) ? component.buttons : [];
      buttons.forEach((button: JsonRecord, index: number) => {
        if (String(button.type).toUpperCase() !== 'URL') return;
        if (!/\{\{\d+\}\}/.test(String(button.url || ''))) return;
        result.push({
          type: 'button',
          sub_type: 'url',
          index,
          parameters: [{ type: 'text', text: typeof params[cursor] === 'string' ? params[cursor] : '' }],
        });
        cursor += 1;
      });
    }
  }
  return result;
}

/**
 * Sends an approved template through the WhatsApp Cloud API and returns the
 * WhatsApp message id (`wamid...`).
 *
 * When the recipient is rejected as an invalid parameter, the alternative
 * Brazilian number form (with or without the ninth digit) is tried.
 */
export async function sendMetaTemplateMessage(input: MetaTemplateSendInput): Promise<{ messageId: string }> {
  const components = buildTemplateComponents(
    (Array.isArray(input.components) ? input.components : []) as JsonRecord[],
    input.templateParams,
  );
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    type: 'template',
    template: {
      name: input.templateName,
      language: { code: input.templateLanguage },
      ...(components.length ? { components } : {}),
    },
  };

  const variants = whatsappNumberVariants(input.to);
  let lastError: unknown = null;
  for (const recipient of variants) {
    try {
      const result = await graphJson<{ messages?: { id?: string }[] }>(`/${input.phoneNumberId}/messages`, {
        method: 'POST',
        token: input.token,
        body: { ...payload, to: recipient },
      });
      const messageId = result.messages?.[0]?.id;
      if (typeof messageId !== 'string' || !messageId) {
        throw new Error('A Meta aceitou o envio, mas não retornou o identificador da mensagem.');
      }
      return { messageId };
    } catch (error) {
      lastError = error;
      const invalidRecipient = error instanceof MetaApiError
        && error.status === 400
        && (error.code === 100 || error.subcode === 33);
      if (!invalidRecipient) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('A Meta recusou o envio para o número informado.');
}
