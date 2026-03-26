import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mapeia abreviações de dias para índices JS (0=dom ... 6=sab)
// Aceita tanto português (seg, ter...) quanto inglês (mon, tue...) pois o
// frontend pode salvar qualquer um dos dois formatos.
const DAY_MAP: Record<string, number> = {
    // Português
    dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6,
    // Inglês
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

/**
 * Calcula a próxima data de cobrança preservando o HH:mm:ss original,
 * garantindo que o faturamento nunca ocorra antes do horário definido no contrato.
 */
function calcularProximaData(
    dataAtual: Date,
    config: {
        frequencia: string
        intervalo: number
        dias: string[]
    }
): Date {
    // Preserva o horário exato (HH:mm:ss) da data original
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

        // Fix 6: Validar dias antes de entrar no loop para evitar loop infinito
        if (selectedIndices.length === 0) {
            console.warn('Nenhum dia válido configurado para recorrência semanal. Avançando 7 dias.')
            proxima.setUTCDate(proxima.getUTCDate() + 7)
        } else {
            // Fix 2: Implementar pulo de semanas correto com base no intervalo
            // Avança dia a dia até encontrar o próximo dia válido.
            // Se voltou ao início do ciclo semanal (passou por dom), aplica o pulo de intervalo - 1 semanas.
            let encontrou = false
            let counts = 0
            let voltouInicioCiclo = false

            while (!encontrou && counts < 365) {
                const diaAnterior = proxima.getUTCDay()
                proxima.setUTCDate(proxima.getUTCDate() + 1)
                counts++

                const diaAtual = proxima.getUTCDay()

                // Detecta a virada de ciclo semanal (passou pelo domingo para seg)
                if (!voltouInicioCiclo && diaAnterior > diaAtual) {
                    // Pulamos (intervalo - 1) semanas extras
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
                console.error('Não foi possível calcular próxima data semanal — avançando 7 dias como fallback.')
                proxima.setUTCDate(dataAtual.getUTCDate() + 7)
            }
        }

    } else if (config.frequencia === 'monthly') {
        proxima.setUTCMonth(proxima.getUTCMonth() + (config.intervalo || 1))
    }

    // Fix 1: Reaplicar o horário original após o cálculo da data
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
        const userId: string | undefined = typeof body.userId === 'string' ? body.userId : undefined

        console.log('--- Iniciando faturamento inteligente ---')

        // 1. Busca contratos ativos com cobrança para agora ou atrasada
        let query = supabase
            .from('contratos')
            .select(`
                id, id_usuario, valor, recorrencia, proxima_cobranca, ocorrencias_realizadas,
                usuarios!inner ( access_token_mercado_pago ),
                locatarios!inner ( nome_completo, email, cpf )
            `)
            .eq('status', 'ativo')
            .lte('proxima_cobranca', new Date().toISOString())

        if (userId) query = query.eq('id_usuario', userId)

        const { data: contratos, error: fetchError } = await query
        if (fetchError) throw fetchError
        if (!contratos || contratos.length === 0) {
            return new Response(
                JSON.stringify({ message: 'Nada para faturar.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const results: { id: string; status: string; msg?: string }[] = []

        for (const contrato of contratos) {
            try {
                // --- PARSING DA RECORRÊNCIA ---
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

                // --- GUARD DE DEDUPLICAÇÃO ---
                // Impede criar cobrança duplicada caso o cron rode mais de uma vez
                // para o mesmo contrato no mesmo período de faturamento.
                const dataVencimentoCheck = new Date(contrato.proxima_cobranca).toISOString().split('T')[0]
                const { count: jaExiste } = await supabase
                    .from('cobrancas')
                    .select('id', { count: 'exact', head: true })
                    .eq('id_contrato', contrato.id)
                    .eq('data_vencimento', dataVencimentoCheck)
                    .in('status', ['pendente', 'pago'])

                if (jaExiste && jaExiste > 0) {
                    console.warn(`Cobrança duplicada ignorada para contrato ${contrato.id} em ${dataVencimentoCheck}.`)
                    results.push({ id: contrato.id, status: 'skipped_duplicate' })
                    continue
                }

                // --- MERCADO PAGO PAYLOAD ---
                const locatarioNome = contrato.locatarios.nome_completo?.split(' ').slice(0, 2).join(' ') ?? 'Locatário'
                const docLimpo = (contrato.locatarios.cpf || '').replace(/\D/g, '')
                const tipoDoc = docLimpo.length > 11 ? 'CNPJ' : 'CPF'

                // Expiração dinâmica do PIX (em horas)
                const expirationDate = new Date()
                expirationDate.setHours(expirationDate.getHours() + (config.expiracao || 4))

                const mpPayload = {
                    description: `Aluguel: ${locatarioNome}`,
                    external_reference: contrato.id,
                    notification_url: NOTIFICATION_URL,
                    payer: {
                        email: contrato.locatarios.email,
                        identification: { type: tipoDoc, number: docLimpo },
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

                // Fix 3: data_vencimento usa proxima_cobranca do contrato, não "hoje"
                const dataVencimento = new Date(contrato.proxima_cobranca).toISOString().split('T')[0]

                // Fix 4: capturar erro do insert de cobrança
                const { error: insertError } = await supabase.from('cobrancas').insert({
                    id_contrato: contrato.id,
                    id_usuario: contrato.id_usuario,
                    valor: contrato.valor,
                    data_vencimento: dataVencimento,
                    status: 'pendente',
                    mercado_pago_id: mpData.id.toString(),
                    payment_link: mpData.point_of_interaction?.transaction_data?.ticket_url ?? null,
                })
                if (insertError) throw new Error(`Erro ao salvar cobrança: ${insertError.message}`)

                // --- CALCULAR PRÓXIMA DATA (Fix 1+2: preserva horário e intervalo correto) ---
                const novasRealizadas = (contrato.ocorrencias_realizadas || 0) + 1
                const dataAtual = new Date(contrato.proxima_cobranca)
                const proximaData = calcularProximaData(dataAtual, config)
                let novoStatus = 'ativo'

                // --- VERIFICAR TÉRMINO ---
                if (config.termina?.tipo === 'ocorrencia' && novasRealizadas >= (config.termina.valor as number)) {
                    novoStatus = 'encerrado'
                } else if (config.termina?.tipo === 'data' && config.termina.valor) {
                    if (proximaData > new Date(config.termina.valor as string)) novoStatus = 'encerrado'
                }

                // Fix 5: capturar erro do update de contrato
                const { error: updateError } = await supabase.from('contratos').update({
                    proxima_cobranca: proximaData.toISOString(),
                    ocorrencias_realizadas: novasRealizadas,
                    status: novoStatus,
                }).eq('id', contrato.id)

                if (updateError) throw new Error(`Erro ao atualizar contrato: ${updateError.message}`)

                console.log(`Contrato ${contrato.id}: OK — próxima cobrança em ${proximaData.toISOString()}`)
                results.push({ id: contrato.id, status: 'ok' })

            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                console.error(`Contrato ${contrato.id}: ERRO —`, msg)
                results.push({ id: contrato.id, status: 'error', msg })
            }
        }

        return new Response(
            JSON.stringify({ results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('Erro geral no faturamento:', msg)
        return new Response(
            JSON.stringify({ error: msg }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
