import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DEFAULT_RESERVATION_AMOUNT_CENTS = 2500
const MIN_RESERVATION_AMOUNT_CENTS = 100
const MAX_RESERVATION_AMOUNT_CENTS = 1000000
const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000

type Candidate = {
  id: string
  id_usuario: string
  nome: string
  cpf: string
  email: string | null
  status: string | null
  pagamento_id: string | null
  pagamento_status: string | null
  pix_qr_code: string | null
  pix_copia_e_cola: string | null
  pix_url: string | null
  reserva_expira_em: string | null
  reserva_idempotency_key: string | null
  reserva_valor: number | string | null
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function normalizeStatus(value: string | null) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function amountToCents(value: unknown): number | null {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 1 || amount > 10000) return null
  return Math.round(amount * 100)
}

function existingPix(candidate: Candidate, now: Date) {
  const expiresAt = candidate.reserva_expira_em ? new Date(candidate.reserva_expira_em) : null
  if (!candidate.pagamento_id || !candidate.pix_qr_code || !candidate.pix_copia_e_cola || !expiresAt || expiresAt <= now) return null
  return {
    paymentId: candidate.pagamento_id,
    qrCode: candidate.pix_qr_code,
    copyPaste: candidate.pix_copia_e_cola,
    ticketUrl: candidate.pix_url,
    expiresAt: expiresAt.toISOString(),
    amount: Number(candidate.reserva_valor ?? 25),
    alreadyExists: true,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Serviço temporariamente indisponível.' }, 503)

  const authorization = req.headers.get('Authorization') ?? ''
  const bearerToken = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!bearerToken) return json({ error: 'Autenticação obrigatória.' }, 401)

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: { user }, error: authError } = await authClient.auth.getUser(bearerToken)
  if (authError || !user) return json({ error: 'Sessão inválida. Entre novamente.' }, 401)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Requisição inválida.' }, 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Requisição inválida.' }, 400)

  const requestedAmountCents = body.valorCentavos == null ? null : body.valorCentavos
  if (requestedAmountCents !== null && (
    typeof requestedAmountCents !== 'number'
    || !Number.isInteger(requestedAmountCents)
    || requestedAmountCents < MIN_RESERVATION_AMOUNT_CENTS
    || requestedAmountCents > MAX_RESERVATION_AMOUNT_CENTS
  )) {
    return json({ error: 'Informe uma taxa entre R$ 1,00 e R$ 10.000,00, com até duas casas decimais.' }, 400)
  }

  const candidateId = typeof body.candidatoId === 'string' ? body.candidatoId.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateId)) {
    return json({ error: 'Candidato inválido.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: candidateData, error: candidateError } = await admin.from('candidatos')
    .select('id,id_usuario,nome,cpf,email,status,pagamento_id,pagamento_status,pix_qr_code,pix_copia_e_cola,pix_url,reserva_expira_em,reserva_idempotency_key,reserva_valor')
    .eq('id', candidateId)
    .eq('id_usuario', user.id)
    .maybeSingle()

  if (candidateError) {
    console.error('Reservation candidate lookup failed:', candidateError.code ?? 'database_error')
    return json({ error: 'Não foi possível consultar o candidato.' }, 500)
  }
  if (!candidateData) return json({ error: 'Candidato não encontrado.' }, 404)

  let candidate = candidateData as Candidate
  const status = normalizeStatus(candidate.status)
  if (['vaga reservada', 'reserva confirmada'].includes(status) || normalizeStatus(candidate.pagamento_status) === 'confirmado') {
    return json({ error: 'A reserva deste candidato já está confirmada.' }, 409)
  }
  if (status === 'reprovado') return json({ error: 'Candidatos reprovados não podem gerar uma reserva.' }, 409)

  const now = new Date()
  const reusablePix = existingPix(candidate, now)
  if (reusablePix) return json(reusablePix)
  if (candidate.pagamento_id) {
    const expired = candidate.reserva_expira_em && new Date(candidate.reserva_expira_em) <= now
    return json({ error: expired
      ? 'O PIX anterior expirou. A emissão de uma nova cobrança precisa ser feita após a etapa de reconciliação do pagamento.'
      : 'Já existe um pagamento associado, mas os dados necessários para recuperá-lo estão incompletos. Revise o candidato antes de tentar novamente.' }, 409)
  }
  if (!['pre-aprovado', 'aguardando reserva'].includes(status)) {
    return json({ error: 'Aprove o perfil antes de gerar a reserva PIX.' }, 409)
  }
  if (status === 'aguardando reserva' && !candidate.reserva_idempotency_key) {
    return json({ error: 'A reserva está aguardando pagamento, mas não possui chave de recuperação. Revise o candidato antes de tentar novamente.' }, 409)
  }

  let reservationAmountCents: number
  if (candidate.reserva_idempotency_key) {
    const savedAmountCents = amountToCents(candidate.reserva_valor) ?? DEFAULT_RESERVATION_AMOUNT_CENTS
    if (requestedAmountCents !== null && requestedAmountCents !== savedAmountCents) {
      return json({ error: `Já existe uma tentativa de cobrança de ${(savedAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Aguarde a conclusão antes de alterar o valor.` }, 409)
    }
    reservationAmountCents = savedAmountCents
  } else {
    reservationAmountCents = requestedAmountCents ?? amountToCents(candidate.reserva_valor) ?? DEFAULT_RESERVATION_AMOUNT_CENTS
  }

  const requestedEmail = typeof body.email === 'string' ? body.email.trim() : ''
  let payerEmail: string
  if (candidate.reserva_idempotency_key) {
    if (!isEmail(candidate.email)) return json({ error: 'A tentativa PIX anterior não tem um e-mail válido associado. Revise o cadastro antes de continuar.' }, 409)
    if (isEmail(requestedEmail) && requestedEmail.toLowerCase() !== candidate.email.toLowerCase()) {
      return json({ error: 'Já existe uma tentativa em andamento com outro e-mail. Aguarde a resposta do Mercado Pago para evitar uma cobrança duplicada.' }, 409)
    }
    payerEmail = candidate.email
  } else {
    payerEmail = isEmail(requestedEmail) ? requestedEmail : String(candidate.email ?? '').trim()
    if (!isEmail(payerEmail)) return json({ error: 'Informe um e-mail válido do candidato para gerar o PIX.' }, 400)
  }

  const cpf = String(candidate.cpf ?? '').replace(/\D/g, '')
  if (cpf.length !== 11) return json({ error: 'O CPF do candidato precisa ter 11 dígitos para gerar o PIX.' }, 400)

  const { data: accessToken, error: tokenError } = await admin.rpc('get_user_mp_token', { p_user_id: user.id })
  if (tokenError || typeof accessToken !== 'string' || !accessToken) {
    console.error('Reservation Mercado Pago credential lookup failed:', tokenError?.code ?? 'missing_token')
    return json({ error: 'Configure e valide a credencial do Mercado Pago antes de gerar o PIX.' }, 409)
  }

  const notificationUrl = Deno.env.get('MP_WEBHOOK_URL') ?? ''
  try {
    const parsedNotificationUrl = new URL(notificationUrl)
    if (parsedNotificationUrl.protocol !== 'https:') throw new Error('invalid_webhook_url')
  } catch {
    return json({ error: 'O webhook do Mercado Pago não está configurado corretamente.' }, 503)
  }

  if (!candidate.reserva_idempotency_key) {
    const idempotencyKey = crypto.randomUUID()
    const { data: claimed, error: claimError } = await admin.from('candidatos').update({
      email: payerEmail,
      reserva_idempotency_key: idempotencyKey,
      reserva_valor: reservationAmountCents / 100,
      updated_at: now.toISOString(),
    }).eq('id', candidate.id).eq('id_usuario', user.id)
      .eq('status', candidate.status).is('reserva_idempotency_key', null)
      .select('id,email,status,reserva_idempotency_key,reserva_valor').maybeSingle()

    if (claimError) {
      console.error('Reservation idempotency claim failed:', claimError.code ?? 'database_error')
      return json({ error: 'Não foi possível iniciar a reserva.' }, 500)
    }
    if (claimed) {
      candidate = { ...candidate, email: claimed.email, status: claimed.status, reserva_idempotency_key: claimed.reserva_idempotency_key, reserva_valor: claimed.reserva_valor }
    } else {
      const { data: refreshed, error: refreshError } = await admin.from('candidatos')
        .select('id,id_usuario,nome,cpf,email,status,pagamento_id,pagamento_status,pix_qr_code,pix_copia_e_cola,pix_url,reserva_expira_em,reserva_idempotency_key,reserva_valor')
        .eq('id', candidate.id).eq('id_usuario', user.id).maybeSingle()
      const refreshedEmail = refreshed?.email
      if (refreshError || !refreshed?.reserva_idempotency_key || !isEmail(refreshedEmail)) {
        return json({ error: 'A reserva está sendo iniciada. Atualize a fila e tente novamente.' }, 409)
      }
      candidate = { ...(refreshed as Candidate), email: refreshedEmail }
      if (normalizeStatus(candidate.status) !== 'pre-aprovado' && normalizeStatus(candidate.status) !== 'aguardando reserva') {
        return json({ error: 'O status do candidato mudou. Atualize a fila antes de continuar.' }, 409)
      }
      if (refreshedEmail.toLowerCase() !== payerEmail.toLowerCase()) {
        return json({ error: 'Outra tentativa iniciou a reserva com um e-mail diferente. Atualize a fila e confirme o e-mail salvo.' }, 409)
      }
      const savedAmountCents = amountToCents(candidate.reserva_valor) ?? DEFAULT_RESERVATION_AMOUNT_CENTS
      if (savedAmountCents !== reservationAmountCents) {
        return json({ error: `Outra tentativa iniciou a cobrança de ${(savedAmountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Atualize a fila antes de tentar novamente.` }, 409)
      }
      reservationAmountCents = savedAmountCents
      payerEmail = refreshedEmail
    }
  }

  if (!candidate.reserva_idempotency_key || !isEmail(candidate.email)) {
    return json({ error: 'Não foi possível preparar os dados do pagador.' }, 409)
  }

  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS)
  const firstName = candidate.nome.trim().split(/\s+/)[0] || 'Candidato'
  let mpResponse: Response
  try {
    mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': candidate.reserva_idempotency_key,
      },
      body: JSON.stringify({
        transaction_amount: reservationAmountCents / 100,
        description: 'Taxa de reserva de vaga',
        external_reference: candidate.id,
        notification_url: notificationUrl,
        date_of_expiration: expiresAt.toISOString(),
        payment_method_id: 'pix',
        payer: {
          email: payerEmail,
          first_name: firstName,
          identification: { type: 'CPF', number: cpf },
        },
        metadata: { id_candidato: candidate.id, id_usuario: user.id },
      }),
      signal: AbortSignal.timeout(20000),
    })
  } catch (error) {
    console.error('Mercado Pago reservation request failed:', error instanceof Error ? error.name : 'network_error')
    return json({ error: 'Não foi possível conectar ao Mercado Pago. Tente novamente; a tentativa continuará protegida contra duplicidade.' }, 502)
  }

  const payment = await mpResponse.json().catch(() => ({}))
  if (!mpResponse.ok) {
    console.error('Mercado Pago reservation request failed:', { httpStatus: mpResponse.status, error: payment.error ?? 'provider_error' })
    if ([400, 401, 403, 422].includes(mpResponse.status)) {
      const { error: releaseError } = await admin.from('candidatos').update({
        reserva_idempotency_key: null,
        updated_at: new Date().toISOString(),
      }).eq('id', candidate.id).eq('id_usuario', user.id)
        .eq('reserva_idempotency_key', candidate.reserva_idempotency_key).is('pagamento_id', null)
      if (releaseError) console.error('Reservation idempotency claim release failed:', releaseError.code ?? 'database_error')
    }
    return json({ error: 'O Mercado Pago não conseguiu gerar o PIX. Tente novamente; a tentativa continuará protegida contra duplicidade.' }, 502)
  }

  const transactionData = payment.point_of_interaction?.transaction_data
  const qrCode = typeof transactionData?.qr_code_base64 === 'string' ? transactionData.qr_code_base64 : ''
  const copyPaste = typeof transactionData?.qr_code === 'string' ? transactionData.qr_code : ''
  const paymentId = payment.id == null ? '' : String(payment.id)
  if (!paymentId || !qrCode || !copyPaste) {
    console.error('Mercado Pago returned an incomplete reservation PIX response:', { hasPaymentId: Boolean(paymentId), hasQrCode: Boolean(qrCode), hasCopyPaste: Boolean(copyPaste) })
    return json({ error: 'O Mercado Pago retornou dados incompletos para o PIX. Tente novamente.' }, 502)
  }

  const actualExpiresAt = typeof payment.date_of_expiration === 'string' ? payment.date_of_expiration : expiresAt.toISOString()
  const ticketUrl = typeof transactionData.ticket_url === 'string' ? transactionData.ticket_url : null
  const { error: attemptError } = await admin.from('candidato_reserva_pagamentos').upsert({
    id_candidato: candidate.id,
    id_usuario: user.id,
    mercado_pago_id: paymentId,
    status: String(payment.status ?? 'pending'),
    status_detalhe: payment.status_detail ?? null,
    valor: Number(payment.transaction_amount ?? reservationAmountCents / 100),
    expira_em: actualExpiresAt,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'mercado_pago_id', ignoreDuplicates: true })
  if (attemptError) {
    console.error('Reservation payment attempt persistence failed:', attemptError.code ?? 'database_error')
    return json({ error: 'O PIX foi criado, mas não foi possível registrar a tentativa. Atualize a fila antes de continuar.' }, 503)
  }
  const { data: saved, error: saveError } = await admin.from('candidatos').update({
    pagamento_id: paymentId,
    pagamento_status: 'Pendente',
    status: 'Aguardando reserva',
    pix_qr_code: qrCode,
    pix_copia_e_cola: copyPaste,
    pix_url: ticketUrl,
    reserva_expira_em: actualExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', candidate.id).eq('id_usuario', user.id)
    .eq('reserva_idempotency_key', candidate.reserva_idempotency_key)
    .in('status', ['Pré-aprovado', 'Pre-aprovado', 'Aguardando reserva', 'Aguardando Reserva'])
    .select('id,pagamento_id,pix_qr_code,pix_copia_e_cola,pix_url,reserva_expira_em').maybeSingle()

  if (saveError) {
    console.error('Reservation PIX persistence failed:', saveError.code ?? 'database_error')
    return json({ error: 'O PIX foi criado, mas não foi possível salvar a reserva. Tente novamente para recuperar o mesmo pagamento.' }, 503)
  }

  if (!saved) {
    const { data: current } = await admin.from('candidatos')
      .select('pagamento_id,pix_qr_code,pix_copia_e_cola,pix_url,reserva_expira_em')
      .eq('id', candidate.id).eq('id_usuario', user.id).maybeSingle()
    if (!current || current.pagamento_id !== paymentId) {
      return json({ error: 'O candidato mudou durante a criação do PIX. Atualize a fila antes de continuar.' }, 409)
    }
    return json({
      paymentId: current.pagamento_id,
      qrCode: current.pix_qr_code,
      copyPaste: current.pix_copia_e_cola,
      ticketUrl: current.pix_url,
      expiresAt: current.reserva_expira_em,
      alreadyExists: true,
    })
  }

  return json({ paymentId, qrCode, copyPaste, ticketUrl, expiresAt: actualExpiresAt, amount: Number(payment.transaction_amount ?? reservationAmountCents / 100), alreadyExists: false })
})
