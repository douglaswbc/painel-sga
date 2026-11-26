import crypto from 'node:crypto';
import { getDb } from '../db/database.js';
import { whatsappNumberVariants } from './meta-messages.js';

export type LockOtpKind = 'otp' | 'not_found' | 'unauthorized' | 'invalid_code' | 'none';

export type LockOtpOutcome = {
  handled: boolean;
  kind: LockOtpKind;
  reply: string | null;
  event?: string;
};

export const normalizePhoneNumber = whatsappNumberVariants;

export function handleLockOtp(
  ownerId: string,
  senderPhone: string,
  messageContent: string,
): LockOtpOutcome {
  const phoneDigits = String(senderPhone || '').replace(/\D/g, '');
  if (!phoneDigits) {
    return { handled: false, kind: 'none', reply: null };
  }

  const senderVariants = normalizePhoneNumber(phoneDigits);
  const cleanMsg = String(messageContent || '').trim().toLowerCase();
  const db = getDb();

  if (cleanMsg.startsWith('abrir')) {
    const identificador = cleanMsg.replace(/^abrir/, '').trim();
    const fechadura = db
      .prepare('SELECT id, nome FROM fechaduras WHERE id_usuario = ? AND identificador = ?')
      .get(ownerId, identificador) as { id: string; nome: string } | undefined;

    if (!fechadura) {
      return { handled: true, kind: 'not_found', reply: `⚠️ Porta "${identificador}" não encontrada.` };
    }

    const placeholders = senderVariants.map(() => '?').join(', ');
    const locatario = db
      .prepare(
        `SELECT id, nome_completo, ativo
         FROM locatarios
         WHERE id_usuario = ? AND whatsapp IN (${placeholders}) AND ativo = 1
         LIMIT 1`,
      )
      .get(ownerId, ...senderVariants) as { id: string; nome_completo: string; ativo: number } | undefined;

    if (!locatario) {
      return {
        handled: true,
        kind: 'unauthorized',
        reply: '❌ Você não tem autorização para abrir esta porta ou seu cadastro está inativo.',
      };
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `DELETE FROM fechadura_verificacoes
         WHERE whatsapp IN (${placeholders})
           AND id_fechadura IN (SELECT id FROM fechaduras WHERE id_usuario = ?)`,
      ).run(...senderVariants, ownerId);

      db.prepare(
        `INSERT INTO fechadura_verificacoes (id, whatsapp, id_fechadura, codigo_otp, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), phoneDigits, fechadura.id, otp, expiresAt);

      db.prepare(
        `INSERT INTO fechadura_logs (id, id_usuario, id_locatario, id_fechadura, whatsapp, evento, detalhes)
         VALUES (?, ?, ?, ?, ?, 'solicitado', ?)`,
      ).run(
        crypto.randomUUID(),
        ownerId,
        locatario.id,
        fechadura.id,
        phoneDigits,
        `Solicitou abertura da porta: ${fechadura.nome}`,
      );

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return {
      handled: true,
      kind: 'otp',
      event: 'solicitado',
      reply: `🔐 *Solicitação de Abertura*\nPorta: ${fechadura.nome}\n\nPara confirmar, responda apenas com o código de 6 dígitos: *${otp}*`,
    };
  }

  if (/^\d{6}$/.test(cleanMsg)) {
    const placeholders = senderVariants.map(() => '?').join(', ');
    const nowIso = new Date().toISOString();
    const verificacao = db
      .prepare(
        `SELECT v.id, v.id_fechadura, v.codigo_otp, f.nome AS fechadura_nome, f.id_usuario AS fechadura_owner
         FROM fechadura_verificacoes v
         JOIN fechaduras f ON f.id = v.id_fechadura
         WHERE v.whatsapp IN (${placeholders}) AND v.expires_at > ? AND f.id_usuario = ?
         ORDER BY v.created_at DESC
         LIMIT 1`,
      )
      .get(...senderVariants, nowIso, ownerId) as
      | { id: string; id_fechadura: string; codigo_otp: string; fechadura_nome: string; fechadura_owner: string }
      | undefined;

    if (!verificacao) {
      return { handled: false, kind: 'none', reply: null };
    }

    if (verificacao.codigo_otp !== cleanMsg) {
      return {
        handled: true,
        kind: 'invalid_code',
        reply: '❌ Código incorreto. Tente novamente ou peça um novo código.',
      };
    }

    const token = Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO fechadura_comandos (id, id_fechadura, token_acesso, status, expires_at)
         VALUES (?, ?, ?, 'pendente', ?)`,
      ).run(crypto.randomUUID(), verificacao.id_fechadura, token, expiresAt);

      db.prepare('DELETE FROM fechadura_verificacoes WHERE id = ?').run(verificacao.id);

      db.prepare(
        `INSERT INTO fechadura_logs (id, id_usuario, id_fechadura, whatsapp, evento, detalhes)
         VALUES (?, ?, ?, ?, 'otp_validado', ?)`,
      ).run(
        crypto.randomUUID(),
        ownerId,
        verificacao.id_fechadura,
        phoneDigits,
        `Acesso autorizado para a porta: ${verificacao.fechadura_nome}`,
      );

      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return {
      handled: true,
      kind: 'otp',
      event: 'otp_validado',
      reply: '✅ *Acesso Autorizado!*\nA porta será liberada agora. Você tem 1 minuto.',
    };
  }

  return { handled: false, kind: 'none', reply: null };
}
