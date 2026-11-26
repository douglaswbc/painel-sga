import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailySummaryEmail,
  getYesterdayBrtRange,
  summarizeDailyData,
} from '../services/daily-summary.js';

test('calcula intervalo exato do dia anterior no horario de Brasilia', () => {
  // 2026-11-26 08:00 BRT = 2026-11-26 11:00 UTC
  const range = getYesterdayBrtRange(new Date('2026-11-26T11:00:00.000Z'));
  assert.equal(range.todayDate, '2026-11-26');
  assert.equal(range.referenceDate, '2026-11-25');
  assert.equal(range.startIso, '2026-11-25T03:00:00.000Z');
  assert.equal(range.endIso, '2026-11-26T03:00:00.000Z');
});

test('calcula corretamente cobranças pagas, pendentes e custo estimado WhatsApp', () => {
  const summary = summarizeDailyData(
    '2026-11-25',
    [
      {
        id: '1',
        valor: 650,
        status: 'pago',
        tipo: 'receita',
        categoria: 'aluguel',
        locatarios: { nome_completo: 'Carlos Souza' },
      },
      {
        id: '2',
        valor: '500.50',
        status: 'pendente',
        tipo: 'receita',
        categoria: 'aluguel',
        locatarios: { nome_completo: 'Ana Lima' },
      },
      {
        id: '3',
        valor: 200,
        status: 'atrasado',
        tipo: 'receita',
        categoria: 'multa',
        locatarios: { nome_completo: 'Bruno Dias' },
      },
      {
        id: '4',
        valor: 999,
        status: 'pago',
        tipo: 'despesa',
        categoria: 'manutencao',
      },
      {
        id: '5',
        valor: 300,
        status: 'cancelado',
        tipo: 'receita',
      },
    ],
    [
      { status: 'sent', category: 'UTILITY', recipient_phone: '5511999990001' },
      { status: 'sent', category: 'UTILITY', recipient_phone: '11999990002' },
      { status: 'sent', category: 'MARKETING', recipient_phone: '5511999990003' },
      { status: 'sent', category: 'AUTHENTICATION', recipient_phone: '5511999990004' },
      { status: 'failed', category: 'MARKETING', recipient_phone: '5511999990005' },
      { status: 'sent', category: 'UTILITY', recipient_phone: '442079460958' },
    ],
  );

  assert.equal(summary.referenceDateLabel, '25/11/2026');
  assert.equal(summary.paid.count, 1);
  assert.equal(summary.paid.total, 650);
  assert.equal(summary.pending.count, 2);
  assert.equal(summary.pending.total, 700.5);
  assert.equal(summary.expectedTotal, 1350.5);

  assert.equal(summary.whatsapp.totalSent, 5);
  assert.equal(summary.whatsapp.hasUnpricedForeign, true);
  // 2 * 0.035 (UTILITY BR) + 1 * 0.3217 (MARKETING BR) + 1 * 0.035 (AUTH BR) = 0.4267
  assert.equal(Number(summary.whatsapp.totalCostBrl.toFixed(4)), 0.4267);
});

test('monta e-mail HTML e texto com valores e links do SGA', () => {
  const summary = summarizeDailyData(
    '2026-11-25',
    [
      {
        id: '1',
        valor: 600,
        status: 'pago',
        tipo: 'receita',
        locatarios: { nome_completo: 'Maria Oliveira' },
      },
    ],
    [
      { status: 'sent', category: 'UTILITY', recipient_phone: '5511988887777' },
    ],
  );

  const email = buildDailySummaryEmail({
    ownerName: 'Douglas Pereira',
    companyName: 'Locadora Prime',
    summary,
    appUrl: 'https://sga.exemplo.com/',
  });

  assert.ok(email.subject.includes('25/11/2026'));
  assert.ok(email.html.includes('Maria Oliveira'));
  assert.ok(email.html.includes('Locadora Prime'));
  assert.ok(email.html.includes('https://sga.exemplo.com/cobrancas'));
  assert.ok(email.html.includes('https://sga.exemplo.com/mensagens'));
  assert.ok(email.text.includes('Maria Oliveira'));
  assert.ok(email.text.includes('COBRANÇAS PAGAS'));
  assert.equal(email.html.includes('<script'), false);
});
