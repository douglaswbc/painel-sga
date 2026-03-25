import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const NOTIFICATION_URL = Deno.env.get('MP_WEBHOOK_URL')

    const supabase = createClient(supabaseUrl, supabaseKey)

    try {
        const { userId } = await req.json().catch(() => ({}));
        console.log("--- Iniciando faturamento inteligente ---")

        // 1. Busca contratos ativos com cobrança para hoje ou atrasada
        let query = supabase
            .from('contratos')
            .select(`
        id, id_usuario, valor, recorrencia, proxima_cobranca, ocorrencias_realizadas,
        usuarios!inner ( access_token_mercado_pago ),
        locatarios!inner ( nome_completo, email, cpf )
      `)
            .eq('status', 'ativo')
            .lte('proxima_cobranca', new Date().toISOString());

        if (userId) query = query.eq('id_usuario', userId);

        const { data: contratos, error: fetchError } = await query;
        if (fetchError) throw fetchError
        if (!contratos || contratos.length === 0) return new Response(JSON.stringify({ message: 'Nada para faturar.' }), { headers: corsHeaders })

        const results = []

        for (const contrato of contratos) {
            try {
                // --- PARSING DA RECORRÊNCIA ---
                let config = { frequencia: 'weekly', intervalo: 1, dias: ['seg'], termina: { tipo: 'nunca' }, expiracao: 4 };
                try {
                    if (contrato.recorrencia.startsWith('{')) {
                        config = JSON.parse(contrato.recorrencia);
                    } else {
                        // Suporte para legado (formato string)
                        if (contrato.recorrencia.includes('daily')) config.frequencia = 'daily';
                    }
                } catch (e) { console.error("Erro parse recorrencia:", e) }

                // --- MERCADO PAGO PAYLOAD ---
                const locatarioNome = contrato.locatarios.nome_completo.split(' ')[0]
                const docLimpo = (contrato.locatarios.cpf || "").replace(/\D/g, '');
                const tipoDoc = docLimpo.length > 11 ? "CNPJ" : "CPF";

                // Expiração dinâmica do PIX (em horas)
                const expirationDate = new Date();
                expirationDate.setHours(expirationDate.getHours() + (config.expiracao || 4));

                const mpPayload = {
                    description: `Aluguel: ${locatarioNome}`,
                    external_reference: contrato.id,
                    notification_url: NOTIFICATION_URL,
                    payer: {
                        email: contrato.locatarios.email,
                        identification: { type: tipoDoc, number: docLimpo }
                    },
                    payment_method_id: "pix",
                    transaction_amount: Number(contrato.valor),
                    date_of_expiration: expirationDate.toISOString(),
                }

                const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${contrato.usuarios.access_token_mercado_pago}`,
                        'X-Idempotency-Key': crypto.randomUUID(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(mpPayload)
                })

                const mpData = await mpResponse.json()
                if (!mpResponse.ok) throw new Error(`MP Error: ${mpData.message}`)

                // --- SALVAR COBRANÇA ---
                await supabase.from('cobrancas').insert({
                    id_contrato: contrato.id,
                    id_usuario: contrato.id_usuario,
                    valor: contrato.valor,
                    data_vencimento: new Date().toISOString().split('T')[0],
                    status: 'pendente',
                    mercado_pago_id: mpData.id.toString(),
                    payment_link: mpData.point_of_interaction?.transaction_data?.ticket_url
                })

                // --- CALCULAR PRÓXIMA DATA E ATUALIZAR CONTRATO ---
                const novasRealizadas = (contrato.ocorrencias_realizadas || 0) + 1;
                let proximaData = new Date(contrato.proxima_cobranca);
                let novoStatus = 'ativo';

                // Lógica de cálculo da próxima data (Motor de Recorrência)
                const dayMap = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
                const selectedIndices = (config.dias || []).map(d => dayMap[d.toLowerCase()]).filter(v => v !== undefined);

                if (config.frequencia === 'weekly') {
                    let encontrou = false;
                    let counts = 0;
                    while (!encontrou && counts < 365) {
                        proximaData.setDate(proximaData.getDate() + 1);
                        counts++;
                        if (selectedIndices.includes(proximaData.getDay())) {
                            // Se passou de sábado para domingo, pula semanas se o intervalo > 1
                            if (proximaData.getDay() === 0 && config.intervalo > 1) {
                                // Lógica simplificada: se voltamos ao início da semana, aplicamos o pulo
                                // No backend, como rodamos após processar, apenas procuramos o próximo dia válido
                            }
                            encontrou = true;
                        }
                    }
                } else if (config.frequencia === 'daily') {
                    proximaData.setDate(proximaData.getDate() + (config.intervalo || 1));
                } else if (config.frequencia === 'monthly') {
                    proximaData.setMonth(proximaData.getMonth() + (config.intervalo || 1));
                }

                // --- VERIFICAR TÉRMINO ---
                if (config.termina?.tipo === 'ocorrencia' && novasRealizadas >= config.termina.valor) {
                    novoStatus = 'encerrado';
                } else if (config.termina?.tipo === 'data' && config.termina.valor) {
                    if (proximaData > new Date(config.termina.valor)) novoStatus = 'encerrado';
                }

                await supabase.from('contratos').update({
                    proxima_cobranca: proximaData.toISOString(),
                    ocorrencias_realizadas: novasRealizadas,
                    status: novoStatus
                }).eq('id', contrato.id)

                results.push({ id: contrato.id, status: 'ok' })

            } catch (err) {
                results.push({ id: contrato.id, status: 'error', msg: err.message })
            }
        }

        return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
    }
})
