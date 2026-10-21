import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { handleLockOtp } from '../_shared/lock-otp.ts'

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
    const cleanMsg = messageContent.trim().toLowerCase()
    const reply = (text: string) => replyToConversation(apiKey, accountId, conversationId, text)

    const outcome = await handleLockOtp(supabase, integration.id_usuario, phoneDigits, cleanMsg)
    if (outcome.handled && outcome.reply) await reply(outcome.reply)
    return new Response('ok')
  } catch (error) {
    console.error('Lock webhook error:', error)
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
