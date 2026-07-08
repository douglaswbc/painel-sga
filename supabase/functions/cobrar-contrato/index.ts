import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DAY_MAP: Record<string, number> = {
    dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6,
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

function calcularProximaData(
    dataAtual: Date,
    config: {
        frequencia: string
        intervalo: number
        dias: string[]
    }
): Date {
    const horas = dataAtual.getUTCHours()
    const minutos = dataAtual.getUTCMinutes()
    const segundos = dataAtual.getUTCSeconds()

    const proxima = new Date(dataAtual)

    if (config.frequencia === 'daily') {
        proxima.setUTCDate(proxima.getUTCDate() + (config.intervalo || 1))

    } else if (config.frequencia === 'weekly') {
        const selectedIndices = (config.dias || [])
            .map(d => DAY_MAP[d.toLowerCase()])
            .filter(v => v !== undefined)

        if (selectedIndices.length === 0) {
            console.warn('Nenhum dia valido configurado para recorrencia semanal. Avancando 7 dias.')
            proxima.setUTCDate(proxima.getUTCDate() + 7)
        } else {
            let encontrou = false
            let counts = 0
            let voltouInicioCiclo = false

            while (!encontrou && counts < 365) {
                const diaAnterior = proxima.getUTCDay()
                proxima.setUTCDate(proxima.getUTCDate() + 1)
                counts++

                const diaAtual = proxima.getUTCDay()

                if (!voltouInicioCiclo && diaAnterior > diaAtual) {
                    if ((config.intervalo || 1) > 1) {
                        proxima.setUTCDate(proxima.getUTCDate() + ((config.intervalo - 1) * 7))
                        voltouInicioCiclo = true
                    }
                }

                if (selectedIndices.includes(proxima.getUTCDay())) {
                    encontrou = true
                }
            }

            if (!encontrou) {
                console.error('Nao foi possivel calcular proxima data semanal — avancando 7 dias como fallback.')
                proxima.setUTCDate(dataAtual.getUTCDate() + 7)
            }
        }

    } else if (config.frequencia === 'monthly') {
        proxima.setUTCMonth(proxima.getUTCMonth() + (config.intervalo || 1))
    }

    proxima.setUTCHours(horas, minutos, segundos, 0)

    return proxima
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
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

        console.log(`--- Cobrando contrato especifico: ${contratoId} ---`)

        const { data: contratos, error: fetchError } = await supabase
            .from('contratos')
            .select(`
                id, id_usuario, valor, recorrencia, proxima_cobranca, ocorrencias_realizadas,
                usuarios!inner ( access_token_mercado_pago ),
                locatarios!inner ( nome_completo, email, cpf )
            `)
            .eq('id', contratoId)
            .eq('status', 'ativo')
            .limit(1)

        if (fetchError) throw fetchError

        if (!contratos || contratos.length === 0) {
            return new Response(
                JSON.stringify({ status: 'error', msg: 'Contrato nao encontrado ou nao esta ativo.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const contrato = contratos[0]

        let config = {
            frequencia: 'monthly',
            intervalo: 1,
            dias: ['seg'],
            termina: { tipo: 'nunca', valor: undefined as number | string | undefined },
            expiracao: 4,
        }

        try {
            if (typeof contrato.recorrencia === 'string') {
                if (contrato.recorrencia.startsWith('{')) {
                    config = { ...config, ...JSON.parse(contrato.recorrencia) }
                } else if (contrato.recorrencia.includes('daily')) {
                    config.frequencia = 'daily'
                }
            }
        } catch (e) {
            console.error(`Erro ao parsear recorrencia do contrato ${contrato.id}:`, e)
        }

        const dataVencimentoCheck = new Date(contrato.proxima_cobranca).toISOString().split('T')[0]
        const { count: jaExiste } = await supabase
            .from('cobrancas')
            .select('id', { count: 'exact', head: true })
            .eq('id_contrato', contrato.id)
            .eq('data_vencimento', dataVencimentoCheck)
            .in('status', ['pendente', 'pago'])

        if (jaExiste && jaExiste > 0) {
            console.warn(`Cobranca duplicada ignorada para contrato ${contrato.id} em ${dataVencimentoCheck}.`)
            return new Response(
                JSON.stringify({ status: 'skipped_duplicate', msg: `Ja existe cobranca pendente/paga para ${dataVencimentoCheck}.` }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const locatarioNome = contrato.locatarios.nome_completo?.split(' ').slice(0, 2).join(' ') ?? 'Locatario'

        const expirationDate = new Date()
        expirationDate.setHours(expirationDate.getHours() + (config.expiracao || 4))

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
                'Authorization': `Bearer ${contrato.usuarios.access_token_mercado_pago}`,
                'X-Idempotency-Key': crypto.randomUUID(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(mpPayload),
        })

        const mpData = await mpResponse.json()
        if (!mpResponse.ok) {
            throw new Error(`Mercado Pago Error [${mpResponse.status}]: ${mpData.message ?? JSON.stringify(mpData)}`)
        }

        const dataVencimento = new Date(contrato.proxima_cobranca).toISOString().split('T')[0]

        const { error: insertError } = await supabase.from('cobrancas').insert({
            id_contrato: contrato.id,
            id_usuario: contrato.id_usuario,
            valor: contrato.valor,
            data_vencimento: dataVencimento,
            status: 'pendente',
            mercado_pago_id: mpData.id.toString(),
            payment_link: mpData.point_of_interaction?.transaction_data?.ticket_url ?? null,
        })
        if (insertError) throw new Error(`Erro ao salvar cobranca: ${insertError.message}`)

        const novasRealizadas = (contrato.ocorrencias_realizadas || 0) + 1
        const dataAtual = new Date(contrato.proxima_cobranca)
        const proximaData = calcularProximaData(dataAtual, config)
        let novoStatus = 'ativo'

        if (config.termina?.tipo === 'ocorrencia' && novasRealizadas >= (config.termina.valor as number)) {
            novoStatus = 'encerrado'
        } else if (config.termina?.tipo === 'data' && config.termina.valor) {
            if (proximaData > new Date(config.termina.valor as string)) novoStatus = 'encerrado'
        }

        const { error: updateError } = await supabase.from('contratos').update({
            proxima_cobranca: proximaData.toISOString(),
            ocorrencias_realizadas: novasRealizadas,
            status: novoStatus,
        }).eq('id', contrato.id)

        if (updateError) throw new Error(`Erro ao atualizar contrato: ${updateError.message}`)

        console.log(`Contrato ${contrato.id}: OK — proxima cobranca em ${proximaData.toISOString()}`)

        return new Response(
            JSON.stringify({ status: 'ok', msg: 'Cobranca gerada com sucesso.', proxima_cobranca: proximaData.toISOString() }),
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
