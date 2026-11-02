import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret } from '../_shared/crypto.ts'
import { sendMetaTemplateMessage } from '../_shared/meta-messages.ts'
import { MetaApiError } from '../_shared/meta-graph.ts'
import { classifyMetaError, recordAndNotifyMetaAlert, resolveMetaAlerts } from '../_shared/meta-alerts.ts'
import { normalizeProvider } from '../_shared/whatsapp-provider.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const ZERNIO_API = 'https://api.zernio.com/v1'
const encoder = new TextEncoder()

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function decrypt(ciphertext: string, ownerId: string): Promise<string> {
  const secret = Deno.env.get('ZERNIO_ENCRYPTION_KEY') ?? ''
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('Zernio encryption key is not configured')
  const [version, encodedIv, encodedCiphertext] = ciphertext.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new Error('Invalid encrypted Zernio credential')
  const keyBytes = Uint8Array.from(secret.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encodedIv), additionalData: encoder.encode(ownerId) }, key, fromBase64(encodedCiphertext),
  )
  return new TextDecoder().decode(clear)
}

/** Decrypts the credential of the active provider (Zernio key or Meta token). */
async function decryptProviderCredential(ciphertext: string, ownerId: string, provider: 'zernio' | 'meta'): Promise<string> {
  return provider === 'meta' ? decryptSecret(ciphertext, ownerId) : decrypt(ciphertext, ownerId)
}

function templateParameterCount(components: any[] = []): number {
  const ordered = [
    ...components.filter((component) => String(component.type).toUpperCase() === 'HEADER'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BODY'),
    ...components.filter((component) => String(component.type).toUpperCase() === 'BUTTONS'),
  ]
  let count = 0
  for (const component of ordered) {
    const texts = String(component.type).toUpperCase() === 'BUTTONS'
      ? (Array.isArray(component.buttons) ? component.buttons : []).map((button: any) => button.url)
      : [component.text]
    for (const text of texts) {
      const variables = [...new Set([...String(text ?? '').matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b)
      if (variables.some((value, index) => value !== index + 1)) return -1
      count += variables.length
    }
  }
  return count
}

async function sendPaymentConfirmation(admin: any, ownerId: string, paymentId: string, target: any, amountValue: number, paidAt: string, targetColumn: 'id_cobranca' | 'id_candidato', targetId: string) {
  const phoneValue = target?.whatsapp ?? target?.telefone
  if (!phoneValue) return
  const { data: integration } = await admin.from('zernio_integracoes')
    .select('provider,api_key_ciphertext,whatsapp_account_id,key_status,meta_access_token_ciphertext,meta_status,meta_phone_number_id')
    .eq('id_usuario', ownerId).maybeSingle()
  const provider = normalizeProvider(integration?.provider)
  const channelId = provider === 'meta' ? integration?.meta_phone_number_id : integration?.whatsapp_account_id
  const credential = provider === 'meta' ? integration?.meta_access_token_ciphertext : integration?.api_key_ciphertext
  if (!credential || !channelId) return
  if (provider === 'meta' && integration?.meta_status === 'invalid') return
  if (provider === 'zernio' && integration?.key_status !== 'valid') return

  const { data: templateUsage } = await admin.from('zernio_whatsapp_template_usages')
    .select('template_id,variable_mapping')
    .eq('id_usuario', ownerId).eq('provider', provider).eq('account_id', channelId)
    .eq('purpose', 'payment_confirmation').eq('is_default', true).maybeSingle()
  if (!templateUsage) return
  const { data: template } = await admin.from('zernio_whatsapp_templates')
    .select('name,language,account_id,components,status')
    .eq('id', templateUsage.template_id).eq('id_usuario', ownerId).eq('provider', provider).eq('account_id', channelId)
    .eq('status', 'APPROVED').maybeSingle()
  if (!template) return

  const { data: notification } = await admin.from('zernio_payment_notifications').insert({
    mercado_pago_id: paymentId,
    [targetColumn]: targetId,
    id_usuario: ownerId,
    idempotency_key: `sga-payment-${paymentId}`,
    status: 'sending',
  }).select('id,idempotency_key').maybeSingle()
  let attempt = notification
  if (!attempt) {
    const { data: existing } = await admin.from('zernio_payment_notifications').select('*').eq('mercado_pago_id', paymentId).maybeSingle()
    if (!existing || existing.status === 'sent' || existing.status === 'sending') return
    const { data: claimed } = await admin.from('zernio_payment_notifications').update({
      status: 'sending', attempts: existing.attempts + 1, safe_error: null, updated_at: new Date().toISOString(),
    }).eq('id', existing.id).eq('status', 'failed').select('id,idempotency_key').maybeSingle()
    attempt = claimed
  }
  if (!attempt) return

  const firstName = String(target.nome_completo ?? target.nome ?? '').trim().split(/\s+/)[0] || 'Olá'
  const amount = Number(amountValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const values: Record<string, string> = {
    tenant_first_name: firstName,
    amount,
    paid_at: new Date(paidAt).toLocaleDateString('pt-BR'),
  }
  const mapping = [...(templateUsage.variable_mapping || [])].sort((a: any, b: any) => a.position - b.position)
  const expectedCount = templateParameterCount(Array.isArray(template.components) ? template.components : [])
  if (mapping.length !== expectedCount || mapping.some((item: any, index: number) =>
    item.position !== index + 1 || !Object.hasOwn(values, item.field) || !values[item.field])) {
    await admin.from('zernio_payment_notifications').update({ status: 'failed', safe_error: 'invalid_template_mapping', updated_at: new Date().toISOString() }).eq('id', attempt.id)
    return
  }
  const apiKey = await decryptProviderCredential(credential, ownerId, provider)
  const phone = String(phoneValue).replace(/\D/g, '')
  const participantId = phone.startsWith('55') ? phone : `55${phone}`
  const templateParams = mapping.map((item: any) => values[item.field])
  try {
    let messageId: string | null = null
    if (provider === 'meta') {
      const sent = await sendMetaTemplateMessage({
        phoneNumberId: channelId as string,
        token: apiKey,
        to: participantId,
        templateName: template.name,
        templateLanguage: template.language,
        templateParams,
        components: Array.isArray(template.components) ? template.components : [],
      })
      messageId = sent.messageId
    } else {
      const response = await fetch(`${ZERNIO_API}/inbox/conversations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': attempt.idempotency_key,
        },
        body: JSON.stringify({
          accountId: channelId,
          participantId,
          templateName: template.name,
          templateLanguage: template.language,
          templateParams,
        }),
        signal: AbortSignal.timeout(20000),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(`zernio_http_${response.status}`)
      messageId = result.message?.id ?? result.data?.message?.id ?? result.id ?? null
    }
    await admin.from('zernio_payment_notifications').update({
      status: 'sent', message_id: messageId,
      safe_error: null, updated_at: new Date().toISOString(),
    }).eq('id', attempt.id)
    if (provider === 'meta') {
      try {
        await resolveMetaAlerts(admin, ownerId)
      } catch (error) {
        console.error('Could not resolve Meta alerts after payment confirmation:', error instanceof Error ? error.message : error)
      }
    }
  } catch (error) {
    console.error('Payment confirmation failed:', error)
    if (error instanceof MetaApiError) {
      const meta = classifyMetaError(error)
      if (meta) await recordAndNotifyMetaAlert(admin, ownerId, meta)
    }
    await admin.from('zernio_payment_notifications').update({
      status: 'failed', safe_error: error instanceof Error ? error.message.slice(0, 160) : 'send_failed',
      updated_at: new Date().toISOString(),
    }).eq('id', attempt.id)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const payload = await req.json()
    if (payload.action !== 'payment.updated' && payload.type !== 'payment' && payload.topic !== 'payment') {
      return json({ success: true, ignored: true })
    }

    const resourceId = typeof payload.resource === 'string'
      ? payload.resource.split('/').filter(Boolean).pop()
      : (payload.resource ?? '')
    const paymentId = payload.data?.id || resourceId || new URL(req.url).searchParams.get('id') || ''
    if (!paymentId) return json({ error: 'paymentId não encontrado no payload' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
    const { data: charge } = await admin.from('cobrancas')
      .select('*,contratos(usuarios(*),locatarios(*))')
      .eq('mercado_pago_id', String(paymentId)).maybeSingle()
    const { data: reservationAttempt } = !charge
      ? await admin.from('candidato_reserva_pagamentos').select('*').eq('mercado_pago_id', String(paymentId)).maybeSingle()
      : { data: null }
    const { data: candidate } = !charge
      ? await admin.from('candidatos').select('*,usuarios(*)')
        .eq(reservationAttempt ? 'id' : 'pagamento_id', reservationAttempt ? reservationAttempt.id_candidato : String(paymentId))
        .maybeSingle()
      : { data: null }
    if (!charge && !candidate) return json({ error: `Pagamento ${paymentId} não localizado no sistema` }, 404)

    const owner = charge ? charge.contratos?.usuarios : candidate.usuarios
    if (!owner) throw new Error('Locador do pagamento não encontrado')
    const { data: storedToken } = await admin.rpc('get_user_mp_token', { p_user_id: owner.id })
    const accessToken = storedToken || owner.access_token_mercado_pago || ''
    if (!accessToken) throw new Error('Locador sem Access Token configurado.')

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const mpPayment = await mpResponse.json()
    if (!mpResponse.ok) throw new Error(`Mercado Pago retornou HTTP ${mpResponse.status}`)

    if (candidate) {
      const paymentStatus = String(mpPayment.status ?? '').toLowerCase()
      const detail = String(mpPayment.status_detail ?? '').toLowerCase()
      const statusMap: Record<string, string> = {
        approved: 'Confirmado',
        pending: 'Pendente',
        in_process: 'Processando',
        authorized: 'Autorizado',
        rejected: 'Rejeitado',
        cancelled: detail.includes('expired') ? 'Expirado' : 'Cancelado',
        refunded: 'Reembolsado',
        charged_back: 'Contestado',
        in_mediation: 'Em disputa',
      }
      const candidatePaymentStatus = statusMap[paymentStatus]
      if (!candidatePaymentStatus) return json({ success: true, ignored: true, paymentStatus })

      const { error: attemptUpdateError } = await admin.from('candidato_reserva_pagamentos').upsert({
        id_candidato: candidate.id,
        id_usuario: owner.id,
        mercado_pago_id: String(paymentId),
        status: candidatePaymentStatus,
        status_detalhe: mpPayment.status_detail ?? null,
        valor: Number(mpPayment.transaction_amount ?? reservationAttempt?.valor ?? 0),
        expira_em: mpPayment.date_of_expiration ?? reservationAttempt?.expira_em ?? null,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'mercado_pago_id' })
      if (attemptUpdateError) throw new Error('Não foi possível registrar o estado do pagamento da reserva.')

      const currentPayment = String(candidate.pagamento_id ?? '') === String(paymentId)
      const currentCandidateStatus = String(candidate.status ?? '').trim().toLocaleLowerCase('pt-BR')
      const manuallyConfirmed = String(candidate.pagamento_status ?? '').trim().toLocaleLowerCase('pt-BR') === 'confirmado manualmente'
      const alreadyConfirmed = String(candidate.pagamento_status ?? '').trim().toLocaleLowerCase('pt-BR') === 'confirmado'
        && ['vaga reservada', 'reserva confirmada'].includes(currentCandidateStatus)
      let candidateUpdate: Record<string, unknown> | null = null
      if (paymentStatus === 'approved') {
        if (!alreadyConfirmed) {
          candidateUpdate = {
            status: 'Vaga reservada',
            pagamento_status: 'Confirmado',
            reserva_confirmada_em: mpPayment.date_approved ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        }
      } else if (currentPayment && paymentStatus === 'refunded' && !manuallyConfirmed) {
        candidateUpdate = {
          status: 'Pré-aprovado', pagamento_status: candidatePaymentStatus,
          pagamento_id: null, pix_qr_code: null, pix_copia_e_cola: null, pix_url: null,
          reserva_expira_em: null, reserva_idempotency_key: null, reserva_confirmada_em: null,
          updated_at: new Date().toISOString(),
        }
      } else if (currentPayment && !manuallyConfirmed && !['vaga reservada', 'reserva confirmada'].includes(currentCandidateStatus)) {
        if (['rejected', 'cancelled'].includes(paymentStatus)) {
          candidateUpdate = {
            status: 'Pré-aprovado', pagamento_status: candidatePaymentStatus,
            pagamento_id: null, pix_qr_code: null, pix_copia_e_cola: null, pix_url: null,
            reserva_expira_em: null, reserva_idempotency_key: null, reserva_confirmada_em: null,
            updated_at: new Date().toISOString(),
          }
        } else {
          candidateUpdate = {
            status: 'Aguardando reserva', pagamento_status: candidatePaymentStatus,
            updated_at: new Date().toISOString(),
          }
        }
      } else if (currentPayment && ['charged_back', 'in_mediation'].includes(paymentStatus)) {
        candidateUpdate = { pagamento_status: candidatePaymentStatus, updated_at: new Date().toISOString() }
      }

      if (candidateUpdate) {
        let updateQuery = admin.from('candidatos').update(candidateUpdate).eq('id', candidate.id)
        if (paymentStatus !== 'approved') updateQuery = updateQuery.eq('pagamento_id', String(paymentId))
        const { data: updatedCandidate, error: candidateUpdateError } = await updateQuery.select('id').maybeSingle()
        if (candidateUpdateError) throw new Error('Não foi possível atualizar o estado da reserva.')
        if (updatedCandidate && paymentStatus === 'approved') {
          await sendPaymentConfirmation(admin, owner.id, String(paymentId), candidate, Number(mpPayment.transaction_amount ?? 0), String(candidateUpdate.reserva_confirmada_em), 'id_candidato', candidate.id)
        }
      }
    } else if (mpPayment.status === 'approved') {
      if (charge && charge.status !== 'pago') {
        const paidAt = new Date().toISOString()
        const { data: updated } = await admin.from('cobrancas').update({ status: 'pago', data_pagamento: paidAt, next_reminder_at: null })
          .eq('id', charge.id).neq('status', 'pago').select('id').maybeSingle()
        if (updated) await sendPaymentConfirmation(admin, owner.id, String(paymentId), charge.contratos?.locatarios, Number(charge.valor), paidAt, 'id_cobranca', charge.id)
      } else if (candidate && !['vaga reservada', 'reserva confirmada'].includes(String(candidate.status ?? '').trim().toLocaleLowerCase('pt-BR'))) {
        const paidAt = new Date().toISOString()
        const { data: updatedCandidate } = await admin.from('candidatos').update({
          status: 'Vaga reservada', pagamento_status: 'Confirmado', reserva_confirmada_em: paidAt,
        }).eq('id', candidate.id).eq('status', candidate.status).select('id').maybeSingle()
        if (updatedCandidate) await sendPaymentConfirmation(admin, owner.id, String(paymentId), candidate, Number(mpPayment.transaction_amount ?? 0), paidAt, 'id_candidato', candidate.id)
      }
    }
    return json({ success: true })
  } catch (error) {
    console.error('[payment-webhook-receiver] error:', error)
    return json({ error: error instanceof Error ? error.message : 'Erro ao processar o pagamento.' }, 400)
  }
})

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
