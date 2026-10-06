import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const PRIVACY_NOTICE_VERSION = '2026-10-v1'

type Answers = {
  nome?: unknown
  cpf?: unknown
  telefone?: unknown
  email?: unknown
  idade_faixa?: unknown
  tem_220v?: unknown
  trabalha_em_app?: unknown
  caucao_disponivel?: unknown
  possui_processos_criminais?: unknown
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

function validCpf(value: string) {
  const cpf = value.replace(/\D/g, '')
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const digit = (length: number) => {
    let total = 0
    for (let index = 0; index < length; index++) total += Number(cpf[index]) * (length + 1 - index)
    const remainder = (total * 10) % 11
    return remainder === 10 ? 0 : remainder
  }
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10])
}

function booleanOrNull(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 16000) return json({ error: 'Inscrição muito grande.' }, 413)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Inscrições temporariamente indisponíveis.' }, 503)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Requisição inválida.' }, 400)
  }
  const token = typeof body?.token === 'string' ? body.token.trim().toLowerCase() : ''
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: 'Este link de inscrição é inválido ou expirou.' }, 404)

  const form = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers as Answers : null
  if (!form) return json({ error: 'Preencha os dados da inscrição.' }, 400)
  if (typeof body.website === 'string' && body.website.trim()) return json({ success: true })
  const startedAt = Number(body.startedAt)
  const elapsed = Date.now() - startedAt
  if (!Number.isFinite(startedAt) || elapsed < 2500 || elapsed > 4 * 60 * 60 * 1000) {
    return json({ error: 'Aguarde um instante e envie a inscrição novamente.' }, 400)
  }
  if (body.privacyNoticeRead !== true) return json({ error: 'Leia e confirme o aviso de privacidade para continuar.' }, 400)

  const nome = typeof form.nome === 'string' ? form.nome.trim().replace(/\s+/g, ' ') : ''
  const cpf = typeof form.cpf === 'string' ? form.cpf.replace(/\D/g, '') : ''
  const telefone = typeof form.telefone === 'string' ? form.telefone.replace(/\D/g, '') : ''
  const email = typeof form.email === 'string' ? form.email.trim().toLowerCase() : ''
  if (nome.length < 3 || nome.length > 120) return json({ error: 'Informe seu nome completo.' }, 400)
  if (!validCpf(cpf)) return json({ error: 'Informe um CPF válido.' }, 400)
  if (telefone.length < 10 || telefone.length > 13) return json({ error: 'Informe um telefone com DDD válido.' }, 400)
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400)

  const idadeFaixa = typeof form.idade_faixa === 'string' && form.idade_faixa.length <= 32 ? form.idade_faixa.trim() || null : null
  const caucao = typeof form.caucao_disponivel === 'string' && form.caucao_disponivel.length <= 120 ? form.caucao_disponivel.trim() || null : null
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: link, error: linkError } = await admin.from('candidate_application_links')
    .select('id,id_usuario')
    .eq('token_hash', await hashToken(token))
    .eq('ativo', true)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (linkError) {
    console.error('Candidate application link lookup failed:', linkError.code ?? 'database_error')
    return json({ error: 'Não foi possível validar este link agora.' }, 503)
  }
  if (!link) return json({ error: 'Este link de inscrição é inválido ou expirou.' }, 404)

  const { data: quotaAvailable, error: quotaError } = await admin.rpc('consumir_cota_inscricao_candidato', { p_link_id: link.id })
  if (quotaError) {
    console.error('Candidate application quota check failed:', quotaError.code ?? 'database_error')
    return json({ error: 'Inscrições temporariamente indisponíveis.' }, 503)
  }
  if (!quotaAvailable) return json({ error: 'Este link atingiu o limite diário de inscrições. Tente novamente amanhã ou fale com o responsável.' }, 429)

  const { data: candidate, error: insertError } = await admin.from('candidatos').insert({
    id_usuario: link.id_usuario,
    id_link_inscricao: link.id,
    nome,
    cpf,
    telefone,
    email,
    idade_faixa: idadeFaixa,
    tem_220v: booleanOrNull(form.tem_220v),
    trabalha_em_app: booleanOrNull(form.trabalha_em_app),
    caucao_disponivel: caucao,
    possui_processos_criminais: booleanOrNull(form.possui_processos_criminais),
    status: 'Em análise',
    aviso_privacidade_versao: PRIVACY_NOTICE_VERSION,
    aviso_privacidade_lido_em: new Date().toISOString(),
  }).select('id').single()

  if (insertError) {
    if (insertError.code === '23505') return json({ error: 'Já recebemos uma inscrição com este CPF para esta oportunidade.' }, 409)
    console.error('Candidate application insert failed:', insertError.code ?? 'database_error')
    return json({ error: 'Não foi possível enviar a inscrição. Confira os dados e tente novamente.' }, 500)
  }

  const { error: auditError } = await admin.from('candidato_reserva_auditoria').insert({
    id_candidato: candidate.id,
    id_usuario: link.id_usuario,
    operador_id: null,
    acao: 'inscricao_recebida',
    origem: 'sistema',
    status_anterior: null,
    status_novo: 'Em análise',
    pagamento_status_anterior: null,
    pagamento_status_novo: null,
    motivo: 'Inscrição pública recebida pelo link do locador.',
  })
  if (auditError) console.error('Candidate application audit insert failed:', auditError.code ?? 'database_error')

  return json({ success: true })
})
