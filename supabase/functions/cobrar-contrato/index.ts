import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { billingDate, nextContractSchedule, parseRecurrence, paymentIdempotencyKey, reminderStartAt } from '../_shared/billing.ts'

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
        const body = await req.json().catch(() => ({}))
        const contratoId: string | undefined = typeof body.contratoId === 'string' ? body.contratoId : undefined

        if (!contratoId) {
            return new Response(
                JSON.stringify({ error: 'contratoId e obrigatorio.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
            )
        }

        const authorization = req.headers.get('Authorization') || ''
        const bearerToken = authorization.replace(/^Bearer\s+/i, '')
        const isServiceRole = bearerToken === supabaseKey
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

        console.log(`--- Cobrando contrato especifico: ${contratoId} ---`)

        let query = supabase
            .from('contratos')
            .select(`
                id, id_usuario, valor, recorrencia, proxima_cobranca, ocorrencias_realizadas,
                usuarios!inner ( id, reminder_stagger_minutes ),
                locatarios!inner ( nome_completo, email, cpf )
            `)
            .eq('id', contratoId)
            .eq('status', 'ativo')
            .limit(1)

        if (authenticatedUserId) query = query.eq('id_usuario', authenticatedUserId)

        const { data: contratos, error: fetchError } = await query

        if (fetchError) throw fetchError

        if (!contratos || contratos.length === 0) {
            return new Response(
                JSON.stringify({ status: 'error', msg: 'Contrato nao encontrado ou nao esta ativo.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const contrato = contratos[0]

        const { data: mpToken, error: tokenError } = await supabase.rpc('get_user_mp_token', { p_user_id: contrato.id_usuario })
        if (tokenError) throw new Error(`Não foi possível obter a credencial do Mercado Pago: ${tokenError.message}`)
        if (!mpToken) throw new Error('O locador não configurou o token do Mercado Pago.')

        const dataAtual = new Date(contrato.proxima_cobranca)
        const config = parseRecurrence(contrato.recorrencia, dataAtual)
        const dataVencimentoCheck = billingDate(dataAtual)
        const { count: jaExiste, error: duplicateCheckError } = await supabase
            .from('cobrancas')
            .select('id', { count: 'exact', head: true })
            .eq('id_contrato', contrato.id)
            .eq('ciclo_cobranca', dataVencimentoCheck)

        if (duplicateCheckError) throw duplicateCheckError

        if (jaExiste && jaExiste > 0) {
            console.warn(`Cobranca duplicada ignorada para contrato ${contrato.id} em ${dataVencimentoCheck}.`)
            const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config)
            const { error: repairError } = await supabase.from('contratos').update(schedule)
                .eq('id', contrato.id).eq('proxima_cobranca', contrato.proxima_cobranca)
            if (repairError) throw new Error(`A fatura já existe, mas não foi possível avançar o contrato: ${repairError.message}`)
            return new Response(
                JSON.stringify({ status: 'skipped_duplicate', msg: `Já existe uma cobrança ativa para ${dataVencimentoCheck}.` }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const locatarioNome = contrato.locatarios.nome_completo?.split(' ').slice(0, 2).join(' ') ?? 'Locatario'

        const createdAt = new Date()
        const expirationDate = new Date(createdAt.getTime() + (config.expiracao || 4) * 60 * 60 * 1000)
        const staggerIntervalMinutes = Number(contrato.usuarios?.reminder_stagger_minutes ?? 2)
        let firstReminderAt = reminderStartAt(createdAt, config.horario_cobranca || '20:00', expirationDate)

        const { data: latestPending } = await supabase
            .from('cobrancas')
            .select('next_reminder_at')
            .eq('id_usuario', contrato.id_usuario)
            .in('status', ['pendente', 'atrasado'])
            .neq('tipo', 'despesa')
            .gt('next_reminder_at', createdAt.toISOString())
            .order('next_reminder_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (latestPending?.next_reminder_at) {
            const latestDate = new Date(latestPending.next_reminder_at)
            if (firstReminderAt.getTime() <= latestDate.getTime()) {
                const candidate = new Date(latestDate.getTime() + Math.max(1, staggerIntervalMinutes) * 60000)
                if (candidate.getTime() < expirationDate.getTime()) {
                    firstReminderAt = candidate
                }
            }
        }

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

        const dataVencimento = dataVencimentoCheck

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
            const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config)
            const { error: repairError } = await supabase.from('contratos').update(schedule)
                .eq('id', contrato.id).eq('proxima_cobranca', contrato.proxima_cobranca)
            if (repairError) throw new Error(`Já existe cobrança, mas não foi possível avançar o contrato: ${repairError.message}`)
            return new Response(JSON.stringify({ status: 'skipped_duplicate', msg: 'Já existe uma cobrança ativa para este contrato e vencimento.' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            })
        }
        if (insertError) throw new Error(`Erro ao salvar cobranca: ${insertError.message}`)

        const schedule = nextContractSchedule(dataAtual, contrato.ocorrencias_realizadas, config)
        const { error: updateError } = await supabase.from('contratos').update(schedule).eq('id', contrato.id)

        if (updateError) throw new Error(`Erro ao atualizar contrato: ${updateError.message}`)

        console.log(`Contrato ${contrato.id}: OK — proxima cobranca em ${schedule.proxima_cobranca}`)

        return new Response(
            JSON.stringify({ status: 'ok', msg: 'Cobranca gerada com sucesso.', proxima_cobranca: schedule.proxima_cobranca }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('Erro no faturamento do contrato:', msg)
        return new Response(
            JSON.stringify({ status: 'error', msg }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
