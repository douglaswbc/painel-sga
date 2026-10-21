/**
 * Shared handling of the lock access flow over WhatsApp.
 *
 * The landlord receives a message like `abrir portao` and the SGA answers with
 * a one-time code; the tenant replies with the code and the door is released.
 * The logic is shared by every provider, so each webhook only has to deliver
 * the reply through its own transport.
 */

type JsonRecord = Record<string, any>;

/** Numbers may be stored with or without the Brazilian ninth digit. */
export function normalizePhoneNumber(phone: string): string[] {
  const clean = String(phone || '').replace(/\D/g, '');
  const variants = [clean];
  if (clean.startsWith('55') && clean.length === 12) variants.push(`55${clean.slice(2, 4)}9${clean.slice(4)}`);
  else if (clean.startsWith('55') && clean.length === 13) variants.push(`55${clean.slice(0, 4)}${clean.slice(5)}`);
  return [...new Set(variants)];
}

export type LockOtpKind = 'otp' | 'not_found' | 'unauthorized' | 'invalid_code' | 'none';

export type LockOtpOutcome = {
  /** True when the message belongs to the lock flow. */
  handled: boolean;
  /** What the flow decided, so a caller with several owners can prioritize. */
  kind: LockOtpKind;
  /** Text to deliver back to the tenant, when there is something to say. */
  reply: string | null;
  /** Event name stored in the lock audit log. */
  event?: string;
};

/**
 * Applies the lock access flow to an inbound message and returns the reply.
 * The function only reads and writes the database; sending the reply is the
 * responsibility of the caller.
 */
export async function handleLockOtp(
  admin: any,
  ownerId: string,
  senderPhone: string,
  messageContent: string,
): Promise<LockOtpOutcome> {
  const phoneDigits = String(senderPhone || '').replace(/\D/g, '');
  const senderVariants = normalizePhoneNumber(phoneDigits);
  const cleanMsg = String(messageContent || '').trim().toLowerCase();

  if (cleanMsg.startsWith('abrir')) {
    const identificador = cleanMsg.replace('abrir', '').trim();
    const { data: fechadura } = await admin.from('fechaduras').select('id,nome')
      .eq('id_usuario', ownerId).eq('identificador', identificador).maybeSingle();
    if (!fechadura) {
      return { handled: true, kind: 'not_found', reply: `⚠️ Porta "${identificador}" não encontrada.` };
    }

    const { data: locatario } = await admin.from('locatarios').select('id,nome_completo,ativo')
      .eq('id_usuario', ownerId).in('whatsapp', senderVariants).eq('ativo', true).limit(1).maybeSingle();
    if (!locatario) {
      return { handled: true, kind: 'unauthorized', reply: '❌ Você não tem autorização para abrir esta porta ou seu cadastro está inativo.' };
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await admin.from('fechadura_verificacoes').delete().in('whatsapp', senderVariants);
    const { error: insertError } = await admin.from('fechadura_verificacoes').insert({
      whatsapp: phoneDigits, id_fechadura: fechadura.id, codigo_otp: otp, expires_at: expiresAt,
    });
    if (insertError) throw insertError;
    await admin.from('fechadura_logs').insert({
      id_usuario: ownerId, id_locatario: locatario.id, id_fechadura: fechadura.id,
      whatsapp: phoneDigits, evento: 'solicitado', detalhes: `Solicitou abertura da porta: ${fechadura.nome}`,
    });
    return {
      handled: true,
      kind: 'otp',
      event: 'solicitado',
      reply: `🔐 *Solicitação de Abertura*\nPorta: ${fechadura.nome}\n\nPara confirmar, responda apenas com o código de 6 dígitos: *${otp}*`,
    };
  }

  if (/^\d{6}$/.test(cleanMsg)) {
    const { data: verificacao } = await admin.from('fechadura_verificacoes').select('*,fechaduras(nome,id_usuario)')
      .in('whatsapp', senderVariants).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!verificacao) return { handled: false, kind: 'none', reply: null };
    if (verificacao.codigo_otp !== cleanMsg) {
      return { handled: true, kind: 'invalid_code', reply: '❌ Código incorreto. Tente novamente ou peça um novo código.' };
    }
    const token = Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
    await admin.from('fechadura_comandos').insert({
      id_fechadura: verificacao.id_fechadura, token_acesso: token, expires_at: expiresAt,
    });
    await admin.from('fechadura_verificacoes').delete().eq('id', verificacao.id);
    await admin.from('fechadura_logs').insert({
      id_usuario: ownerId, id_fechadura: verificacao.id_fechadura, whatsapp: phoneDigits,
      evento: 'otp_validado', detalhes: `Acesso autorizado para a porta: ${verificacao.fechaduras.nome}`,
    });
    return {
      handled: true,
      kind: 'otp',
      event: 'otp_validado',
      reply: '✅ *Acesso Autorizado!*\nA porta será liberada agora. Você tem 1 minuto.',
    };
  }

  return { handled: false, kind: 'none', reply: null };
}
