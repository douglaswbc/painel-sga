import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  BLOCKING_ALERT_TYPES,
  META_ALERT_DEFINITIONS,
  buildMetaAlertEmail,
  classifyMetaError,
  classifyMetaWebhookError,
  publicMetaAlerts,
} from '../functions/_shared/meta-alerts.ts';
import { MetaApiError } from '../functions/_shared/meta-graph.ts';

function metaError(code: number | null, status = 400, message = 'erro da Meta', userMessage: string | null = null) {
  return new MetaApiError(status, message, code, null, 'OAuthException', userMessage);
}

Deno.test('classifica falha de pagamento como alerta bloqueante', () => {
  const result = classifyMetaError(metaError(131042));
  assert(result);
  assertEquals(result.type, 'pagamento');
  assertEquals(result.severity, 'critical');
  assert(BLOCKING_ALERT_TYPES.includes('pagamento'));
});

Deno.test('classifica conta bloqueada e restrita', () => {
  for (const code of [368, 131031, 130497, 131044]) {
    assertEquals(classifyMetaError(metaError(code))?.type, 'conta_bloqueada');
  }
});

Deno.test('classifica token invalido por codigo ou HTTP 401', () => {
  assertEquals(classifyMetaError(metaError(190))?.type, 'token_invalido');
  assertEquals(classifyMetaError(metaError(102))?.type, 'token_invalido');
  assertEquals(classifyMetaError(metaError(null, 401))?.type, 'token_invalido');
});

Deno.test('classifica permissao, template, limite e configuracao', () => {
  assertEquals(classifyMetaError(metaError(3, 403))?.type, 'permissao');
  assertEquals(classifyMetaError(metaError(132001))?.type, 'template');
  assertEquals(classifyMetaError(metaError(130429))?.type, 'limite_envio');
  assertEquals(classifyMetaError(metaError(null, 429))?.type, 'limite_envio');
  assertEquals(classifyMetaError(metaError(131037))?.type, 'integracao');
});

Deno.test('erros genericos de validacao nao geram alerta', () => {
  assertEquals(classifyMetaError(metaError(100)), null);
  assertEquals(classifyMetaError(new Error('falha local')), null);
});

Deno.test('classifica o erro entregue pelo webhook de status', () => {
  const result = classifyMetaWebhookError(400, { code: 131042, message: 'Pagamento pendente' });
  assertEquals(result?.type, 'pagamento');
  assertEquals(classifyMetaWebhookError(500, null), null);
});

Deno.test('detalhe do alerta e limitado e sanitizado', () => {
  const longMessage = 'Bearer abc123 ' + 'x'.repeat(500);
  const result = classifyMetaError(metaError(131042, 400, 'erro', longMessage));
  assert(result);
  assert(result.detail.length <= 300);
  assert(!result.detail.includes('abc123'));
});

Deno.test('todos os tipos possuem definicao e preferencia unica', () => {
  const types = Object.keys(META_ALERT_DEFINITIONS);
  assertEquals(types.length, 7);
  const preferences = new Set(Object.values(META_ALERT_DEFINITIONS).map((item) => item.preference));
  assertEquals(preferences.size, types.length);
});

Deno.test('e-mail de alerta contem assunto, codigo e acao', () => {
  const email = buildMetaAlertEmail({
    type: 'pagamento',
    ownerName: 'Douglas Silva',
    companyName: 'Douglas Locadora',
    phoneNumber: '+55 11 99999-0000',
    detail: 'Metodo de pagamento recusado',
    code: 131042,
    occurredAt: '2026-11-02T12:00:00.000Z',
    appUrl: 'https://sga.exemplo.com',
  });

  assertEquals(email.subject, META_ALERT_DEFINITIONS.pagamento.subject);
  assertStringIncludes(email.html, 'Douglas');
  assertStringIncludes(email.html, '131042');
  assertStringIncludes(email.html, 'https://business.facebook.com/billing_hub/accounts');
  assertStringIncludes(email.text, 'Metodo de pagamento recusado');
  assert(!email.html.includes('<script'));
});

Deno.test('e-mail relativo usa a URL publica do SGA', () => {
  const email = buildMetaAlertEmail({
    type: 'token_invalido',
    occurredAt: '2026-11-02T12:00:00.000Z',
    appUrl: 'https://sga.exemplo.com/',
  });
  assertStringIncludes(email.html, 'https://sga.exemplo.com/configuracoes');
});

Deno.test('projecao publica ignora tipos desconhecidos', () => {
  const alerts = publicMetaAlerts([
    { id: '1', tipo: 'pagamento', severidade: 'critical', ocorrencias: 2 },
    { id: '2', tipo: 'desconhecido', severidade: 'warning' },
  ]);
  assertEquals(alerts.length, 1);
  assertEquals(alerts[0].tipo, 'pagamento');
  assertEquals(alerts[0].bloqueante, true);
  assertEquals(alerts[0].ocorrencias, 2);
});
