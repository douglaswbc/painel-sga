import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCKING_ALERT_TYPES,
  META_ALERT_DEFINITIONS,
  buildMetaAlertEmail,
  classifyMetaError,
  classifyMetaWebhookError,
  publicMetaAlerts,
} from '../services/meta-alerts.js';
import { MetaApiError } from '../services/meta-graph.js';

function metaError(code: number | null, status = 400, message = 'erro da Meta', userMessage: string | null = null) {
  return new MetaApiError(status, message, code, null, 'OAuthException', userMessage);
}

test('classifica falha de pagamento como alerta bloqueante', () => {
  const result = classifyMetaError(metaError(131042));
  assert.ok(result);
  assert.equal(result.type, 'pagamento');
  assert.equal(result.severity, 'critical');
  assert.ok(BLOCKING_ALERT_TYPES.includes('pagamento'));
});

test('classifica conta bloqueada e restrita', () => {
  for (const code of [368, 131031, 130497, 131044]) {
    assert.equal(classifyMetaError(metaError(code))?.type, 'conta_bloqueada');
  }
});

test('classifica token invalido por codigo ou HTTP 401', () => {
  assert.equal(classifyMetaError(metaError(190))?.type, 'token_invalido');
  assert.equal(classifyMetaError(metaError(102))?.type, 'token_invalido');
  assert.equal(classifyMetaError(metaError(null, 401))?.type, 'token_invalido');
});

test('classifica permissao, template, limite e configuracao', () => {
  assert.equal(classifyMetaError(metaError(3, 403))?.type, 'permissao');
  assert.equal(classifyMetaError(metaError(132001))?.type, 'template');
  assert.equal(classifyMetaError(metaError(130429))?.type, 'limite_envio');
  assert.equal(classifyMetaError(metaError(null, 429))?.type, 'limite_envio');
  assert.equal(classifyMetaError(metaError(131037))?.type, 'integracao');
});

test('erros genericos de validacao nao geram alerta', () => {
  assert.equal(classifyMetaError(metaError(100)), null);
  assert.equal(classifyMetaError(new Error('falha local')), null);
});

test('classifica o erro entregue pelo webhook de status', () => {
  const result = classifyMetaWebhookError(400, { code: 131042, message: 'Pagamento pendente' });
  assert.equal(result?.type, 'pagamento');
  assert.equal(classifyMetaWebhookError(500, null), null);
});

test('detalhe do alerta e limitado e sanitizado', () => {
  const longMessage = 'Bearer abc123 ' + 'x'.repeat(500);
  const result = classifyMetaError(metaError(131042, 400, 'erro', longMessage));
  assert.ok(result);
  assert.ok(result.detail.length <= 300);
  assert.equal(result.detail.includes('abc123'), false);
});

test('todos os tipos possuem definicao e preferencia unica', () => {
  const types = Object.keys(META_ALERT_DEFINITIONS);
  assert.equal(types.length, 7);
  const preferences = new Set(Object.values(META_ALERT_DEFINITIONS).map((item) => item.preference));
  assert.equal(preferences.size, types.length);
});

test('e-mail de alerta contem assunto, codigo e acao', () => {
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

  assert.equal(email.subject, META_ALERT_DEFINITIONS.pagamento.subject);
  assert.ok(email.html.includes('Douglas'));
  assert.ok(email.html.includes('131042'));
  assert.ok(email.html.includes('https://business.facebook.com/billing_hub/accounts'));
  assert.ok(email.text.includes('Metodo de pagamento recusado'));
  assert.equal(email.html.includes('<script'), false);
});

test('e-mail relativo usa a URL publica do SGA', () => {
  const email = buildMetaAlertEmail({
    type: 'token_invalido',
    occurredAt: '2026-11-02T12:00:00.000Z',
    appUrl: 'https://sga.exemplo.com/',
  });
  assert.ok(email.html.includes('https://sga.exemplo.com/configuracoes'));
});

test('projecao publica ignora tipos desconhecidos', () => {
  const alerts = publicMetaAlerts([
    { id: '1', tipo: 'pagamento', severidade: 'critical', ocorrencias: 2 },
    { id: '2', tipo: 'desconhecido', severidade: 'warning' },
  ]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].tipo, 'pagamento');
  assert.equal(alerts[0].bloqueante, true);
  assert.equal(alerts[0].ocorrencias, 2);
});
