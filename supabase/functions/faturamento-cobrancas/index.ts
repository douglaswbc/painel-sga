import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { billingDate, nextContractSchedule, parseRecurrence, paymentIdempotencyKey, reminderStartAt } from '../_shared/billing.ts'
import { isServiceRequest } from '../_shared/cron-auth.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const NOTIFICATION_URL = Deno.env.get('MP_WEBHOOK_URL')

    const supabase = createClient(supabaseUrl, supabaseKey)

    try {
        const authorization = req.headers.get('Authorization') || ''
        const bearerToken = authorization.replace(/^Bearer\s+/i, '')
        const isServiceRole = isServiceRequest(req, supabaseKey)
        let authenticatedUserId: string | undefined

        if (!isServiceRole) {
            if (!bearerToken || !supabaseAnonKey) {
                return new Response(JSON.stringify({ error: 'Autenticação obrigatória.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
                })
            }
            const authClient = createClient(supabaseUrl, supabaseAnonKey)
            const { data: { user }, error: authError } = await authClient.auth.getUser(bearerToken)
            if (authError || !user) {
                return new Response(JSON.stringify({ error: 'Sessão inválida.' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
                })
            }
            authenticatedUserId = user.id
        }

        console.log('--- Iniciando faturamento inteligente ---')

        // 1. Busca contratos ativos com cobrança para agora ou atrasada
        let query = supabase
            .from('contratos')
            .select(`
                id, id_usuario, valor, recorrencia, proxima_cobranca, ocorrencias_realizadas,
                usuarios!inner ( id ),
                locatarios!inner ( nome_completo, email, cpf )
            `)
            .eq('status', 'ativo')
            .lte('proxima_cobranca', new Date().toISOString())

        // Chamadas feitas pelo app só podem processar o próprio locador.
        // O cron usa service_role e processa todos os locadores.
        if (authenticatedUserId) query = query.eq('id_usuario', authenticatedUserId)

        const { data: contratos, error: fetchError } = await query
        if (fetchError) throw fetchError
        if (!contratos || contratos.length === 0) {
            console.log('Faturamento concluído: nenhum contrato ativo vencido neste ciclo.')
            return new Response(
                JSON.stringify({ message: 'Nada para faturar.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const results: { id: string; status: string; msg?: string }[] = []

        for (const contrato of contratos) {
            try {
                const { data: mpToken, error: tokenError } = await supabase.rpc('get_user_mp_token', { p_user_id: contrato.id_usuario })
                if (tokenError) throw new Error(`Falha ao obter token Mercado Pago: ${tokenError.message}`)
                if (!mpToken) throw new Error('Locador sem token do Mercado Pago configurado.')

                const dataAtual = new Date(contrato.proxima_cobranca)
                const config = parseRecurrence(contrato.recorrencia, dataAtual)

                // --- GUARD DE DEDUPLICAÇÃO ---
                // Impede criar cobrança duplicada caso o cron rode mais de uma vez
                // para o mesmo contrato no mesmo período de faturamento.
                const dataVencimentoCheck = billingDate(contrato.proxima_cobranca)
                const { count: jaExiste, error: duplicateCheckError } = await supabase
                    .from('cobrancas')
                    .select('id', { count: 'exact', head: true })
                    .eq('id_contrato', contrato.id)
                    .eq('ciclo_cobranca', dataVencimentoCheck)

                if (duplicateCheckError) throw duplicateCheckError

                if (jaExiste && jaExiste > 0) {
                    // Recupera casos antigos em que a fatura foi gravada, mas o
                    // cursor do contrato não avançou após uma falha parcial.
                    const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config)
                    const { error: repairError } = await supabase.from('contratos').update(schedule)
                        .eq('id', contrato.id).eq('proxima_cobranca', contrato.proxima_cobranca)
                    if (repairError) throw new Error(`Fatura já existe, mas não foi possível avançar o contrato: ${repairError.message}`)
                    console.warn(`Cobrança existente encontrada para contrato ${contrato.id} em ${dataVencimentoCheck}; recorrência reconciliada.`)
                    results.push({ id: contrato.id, status: 'skipped_duplicate' })
                    continue
                }

                // --- MERCADO PAGO PAYLOAD ---
                const locatarioNome = contrato.locatarios.nome_completo?.split(' ').slice(0, 2).join(' ') ?? 'Locatário'

                const createdAt = new Date()
                const expirationDate = new Date(createdAt.getTime() + (config.expiracao || 4) * 60 * 60 * 1000)
                const firstReminderAt = reminderStartAt(createdAt, config.horario_cobranca || '20:00', expirationDate)

                const mpPayload = {
                    description: `Aluguel: ${locatarioNome}`,
                    external_reference: contrato.id,
                    notification_url: NOTIFICATION_URL,
                    payer: {
                        email: contrato.locatarios.email,
                    },
                    payment_method_id: 'pix',
                    transaction_amount: Number(contrato.valor),
                    date_of_expiration: expirationDate.toISOString(),
                }

                const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${mpToken}`,
                        'X-Idempotency-Key': await paymentIdempotencyKey(contrato.id, dataVencimentoCheck),
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(mpPayload),
                })

                const mpData = await mpResponse.json()
                if (!mpResponse.ok) {
                    throw new Error(`Mercado Pago Error [${mpResponse.status}]: ${mpData.message ?? JSON.stringify(mpData)}`)
                }

                // Fix 3: data_vencimento usa proxima_cobranca do contrato, não "hoje"
                const dataVencimento = dataVencimentoCheck

                // Fix 4: capturar erro do insert de cobrança
                const { error: insertError } = await supabase.from('cobrancas').insert({
                    id_contrato: contrato.id,
                    id_usuario: contrato.id_usuario,
                    valor: contrato.valor,
                    data_vencimento: dataVencimento,
                    ciclo_cobranca: dataVencimento,
                    status: 'pendente',
                    mercado_pago_id: mpData.id.toString(),
                    payment_link: mpData.point_of_interaction?.transaction_data?.ticket_url ?? null,
                    pix_expires_at: expirationDate.toISOString(),
                    next_reminder_at: firstReminderAt.toISOString(),
                    reminder_interval_minutes: config.intervalo_lembrete_minutos || 30,
                })
                if (insertError?.code === '23505') {
                    results.push({ id: contrato.id, status: 'skipped_duplicate' })
                    continue
                }
                if (insertError) throw new Error(`Erro ao salvar cobrança: ${insertError.message}`)

                // --- CALCULAR PRÓXIMA DATA (Fix 1+2: preserva horário e intervalo correto) ---
                const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config)

                // Fix 5: capturar erro do update de contrato
                const { error: updateError } = await supabase.from('contratos').update(schedule).eq('id', contrato.id)

                if (updateError) throw new Error(`Erro ao atualizar contrato: ${updateError.message}`)

                console.log(`Contrato ${contrato.id}: OK — próxima cobrança em ${schedule.proxima_cobranca}`)
                results.push({ id: contrato.id, status: 'ok' })

            } catch (err) {
                const msg = err instanceof Error ? err.message : (err?.message ?? JSON.stringify(err))
                console.error(`Contrato ${contrato.id}: ERRO —`, msg)
                results.push({ id: contrato.id, status: 'error', msg })
            }
        }

        console.log(`Faturamento concluído: ${results.filter((item) => item.status === 'ok').length} criada(s), ${results.filter((item) => item.status === 'skipped_duplicate').length} duplicada(s), ${results.filter((item) => item.status === 'error').length} erro(s).`)
        return new Response(
            JSON.stringify({ results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        const msg = error instanceof Error ? error.message : (error?.message ?? JSON.stringify(error))
        console.error('Erro geral no faturamento:', msg)
        return new Response(
            JSON.stringify({ error: msg }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
