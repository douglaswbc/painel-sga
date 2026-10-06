import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Serviço temporariamente indisponível.' }, 503)

  const bearerToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
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
  const action = body?.action
  if (action !== 'status' && action !== 'create' && action !== 'deactivate') return json({ error: 'Ação inválida.' }, 400)

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  if (action === 'status') {
    const { data: link, error } = await admin.from('candidate_application_links')
      .select('ativo,expires_at')
      .eq('id_usuario', user.id)
      .maybeSingle()
    if (error) {
      console.error('Candidate application link status lookup failed:', error.code ?? 'database_error')
      return json({ error: 'Não foi possível consultar o link de inscrição.' }, 500)
    }
    return json({
      exists: Boolean(link),
      active: Boolean(link?.ativo && new Date(link.expires_at).getTime() > Date.now()),
      expiresAt: link?.expires_at ?? null,
    })
  }

  if (action === 'deactivate') {
    const { error } = await admin.from('candidate_application_links')
      .update({ ativo: false, updated_at: new Date().toISOString() })
      .eq('id_usuario', user.id)
    if (error) {
      console.error('Candidate application link deactivation failed:', error.code ?? 'database_error')
      return json({ error: 'Não foi possível desativar o link.' }, 500)
    }
    return json({ success: true })
  }

  const rawToken = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await admin.from('candidate_application_links').upsert({
    id_usuario: user.id,
    token_hash: await hashToken(rawToken),
    ativo: true,
    expires_at: expiresAt,
    requests_day: null,
    requests_today: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id_usuario' })

  if (error) {
    console.error('Candidate application link creation failed:', error.code ?? 'database_error')
    return json({ error: 'Não foi possível gerar o link de inscrição.' }, 500)
  }

  return json({ token: rawToken, expiresAt })
})
