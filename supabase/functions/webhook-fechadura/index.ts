import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-zernio-signature',
}
const ZERNIO_API = 'https://api.zernio.com/v1'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function cryptoKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('ZERNIO_ENCRYPTION_KEY') ?? ''
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('Invalid encryption configuration')
  const bytes = Uint8Array.from(secret.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16))
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt'])
}

async function decrypt(ciphertext: string, ownerId: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = ciphertext.split('.')
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) throw new Error('Invalid encrypted secret')
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(encodedIv), additionalData: encoder.encode(ownerId) },
    await cryptoKey(), fromBase64(encodedCiphertext),
  )
  return decoder.decode(clear)
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

async function validSignature(rawBody: string, secret: string, header: string | null): Promise<boolean> {
  if (!header) return false
  const signature = header.replace(/^sha256=/i, '').trim()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const expected = [toHex(digest), toBase64(digest)]
  return expected.some((candidate) => {
    if (candidate.length !== signature.length) return false
    let mismatch = 0
    for (let index = 0; index < candidate.length; index += 1) mismatch |= candidate.charCodeAt(index) ^ signature.charCodeAt(index)
    return mismatch === 0
  })
}

async function replyToConversation(apiKey: string, accountId: string, conversationId: string, message: string) {
  const response = await fetch(`${ZERNIO_API}/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ accountId, message }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) console.error('Zernio lock reply failed:', response.status, await response.text())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  try {
    const rawBody = await req.text()
    const payload = JSON.parse(rawBody)
    const accountId = payload.account?.accountId ?? payload.account?.id ?? payload.accountId
    const eventId = payload.id ?? req.headers.get('x-zernio-event-id')
    if (typeof accountId !== 'string' || typeof eventId !== 'string' || !eventId) {
      return new Response('Invalid webhook payload', { status: 400, headers: corsHeaders })
    }

    const { data: integration } = await supabase.from('zernio_integracoes')
      .select('id_usuario,api_key_ciphertext,webhook_secret_ciphertext,webhook_account_id,whatsapp_account_id')
      .eq('webhook_account_id', accountId).maybeSingle()
    if (!integration?.webhook_secret_ciphertext || integration.whatsapp_account_id !== accountId) {
      return new Response('Unknown account', { status: 404, headers: corsHeaders })
    }

    const webhookSecret = await decrypt(integration.webhook_secret_ciphertext, integration.id_usuario)
    if (!await validSignature(rawBody, webhookSecret, req.headers.get('x-zernio-signature'))) {
      return new Response('Invalid signature', { status: 401, headers: corsHeaders })
    }

    const eventName = req.headers.get('x-zernio-event') ?? payload.event ?? payload.type
    const message = payload.message ?? payload.data?.message ?? {}
    const conversation = payload.conversation ?? payload.data?.conversation ?? {}
    const direction = message.direction ?? payload.direction
    if (eventName !== 'message.received' || (direction && direction !== 'incoming') || payload.metadata?.standby === true) {
      return new Response(JSON.stringify({ status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { error: dedupeError } = await supabase.from('zernio_webhook_events').insert({
      event_id: eventId, id_usuario: integration.id_usuario, event_type: eventName,
    })
    if (dedupeError?.code === '23505') return new Response(JSON.stringify({ status: 'duplicate' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    if (dedupeError) throw dedupeError

    const sender = message.sender ?? payload.sender ?? {}
    const phone = typeof sender === 'string' ? sender : sender.phoneNumber ?? sender.phone ?? sender.id ?? ''
    const messageContent = message.text ?? message.content ?? message.body ?? ''
    const conversationId = conversation.id ?? message.conversationId
    if (typeof phone !== 'string' || typeof messageContent !== 'string' || !messageContent.trim() || typeof conversationId !== 'string') {
      return new Response(JSON.stringify({ status: 'ignored', reason: 'incomplete_message' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const apiKey = await decrypt(integration.api_key_ciphertext, integration.id_usuario)
    const phoneDigits = phone.replace(/\D/g, '')
    const senderVariants = normalizePhoneNumber(phoneDigits)
    const cleanMsg = messageContent.trim().toLowerCase()
    const reply = (text: string) => replyToConversation(apiKey, accountId, conversationId, text)

    if (cleanMsg.startsWith('abrir')) {
      const identificador = cleanMsg.replace('abrir', '').trim()
      const { data: fechadura } = await supabase.from('fechaduras').select('id,nome')
        .eq('id_usuario', integration.id_usuario).eq('identificador', identificador).maybeSingle()
      if (!fechadura) {
        await reply(`⚠️ Porta "${identificador}" não encontrada.`)
        return new Response('ok')
      }

      const { data: locatario } = await supabase.from('locatarios').select('id,nome_completo,ativo')
        .eq('id_usuario', integration.id_usuario).in('whatsapp', senderVariants).eq('ativo', true).limit(1).maybeSingle()
      if (!locatario) {
        await reply('❌ Você não tem autorização para abrir esta porta ou seu cadastro está inativo.')
        return new Response('ok')
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString()
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      await supabase.from('fechadura_verificacoes').delete().in('whatsapp', senderVariants)
      const { error: insertError } = await supabase.from('fechadura_verificacoes').insert({
        whatsapp: phoneDigits, id_fechadura: fechadura.id, codigo_otp: otp, expires_at: expiresAt,
      })
      if (insertError) throw insertError
      await supabase.from('fechadura_logs').insert({
        id_usuario: integration.id_usuario, id_locatario: locatario.id, id_fechadura: fechadura.id,
        whatsapp: phoneDigits, evento: 'solicitado', detalhes: `Solicitou abertura da porta: ${fechadura.nome}`,
      })
      await reply(`🔐 *Solicitação de Abertura*\nPorta: ${fechadura.nome}\n\nPara confirmar, responda apenas com o código de 6 dígitos: *${otp}*`)
      return new Response('ok')
    }

    if (/^\d{6}$/.test(cleanMsg)) {
      const { data: verificacao } = await supabase.from('fechadura_verificacoes').select('*,fechaduras(nome,id_usuario)')
        .in('whatsapp', senderVariants).gt('expires_at', new Date().toISOString()).maybeSingle()
      if (!verificacao) return new Response('ok')
      if (verificacao.codigo_otp === cleanMsg) {
        const token = Math.random().toString(36).substring(2, 10).toUpperCase()
        const expiresAt = new Date(Date.now() + 60 * 1000).toISOString()
        await supabase.from('fechadura_comandos').insert({ id_fechadura: verificacao.id_fechadura, token_acesso: token, expires_at: expiresAt })
        await supabase.from('fechadura_verificacoes').delete().eq('id', verificacao.id)
        await supabase.from('fechadura_logs').insert({
          id_usuario: integration.id_usuario, id_fechadura: verificacao.id_fechadura, whatsapp: phoneDigits,
          evento: 'otp_validado', detalhes: `Acesso autorizado para a porta: ${verificacao.fechaduras.nome}`,
        })
        await reply('✅ *Acesso Autorizado!*\nA porta será liberada agora. Você tem 1 minuto.')
      } else {
        await reply('❌ Código incorreto. Tente novamente ou peça um novo código.')
      }
    }
    return new Response('ok')
  } catch (error) {
    console.error('Lock webhook error:', error)
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

function normalizePhoneNumber(phone: string): string[] {
  const clean = phone.replace(/\D/g, '')
  const variants = [clean]
  if (clean.startsWith('55') && clean.length === 12) variants.push(`55${clean.slice(2, 4)}9${clean.slice(4)}`)
  else if (clean.startsWith('55') && clean.length === 13) variants.push(`55${clean.slice(0, 4)}${clean.slice(5)}`)
  return [...new Set(variants)]
}
