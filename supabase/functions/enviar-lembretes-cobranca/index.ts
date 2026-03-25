import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        console.log("=== INÍCIO RÉGUA DINÂMICA DE COBRANÇA ===")

        // 🔎 Ajuste fuso horário Brasil
        const agora = new Date()
        const brasiliaTime = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(agora)

        const [dia, mes, ano] = brasiliaTime.split('/')
        const hoje = `${ano}-${mes}-${dia}`

        // 🔎 Busca cobranças pendentes do dia (incluindo created_at e ultimo_lembrete_at)
        const { data: cobrancas, error: fetchError } = await supabase
            .from('cobrancas')
            .select(`
                id,
                valor,
                data_vencimento,
                created_at,
                tentativas_envio,
                ultimo_lembrete_at,
                mercado_pago_id,
                payment_link,
                status,
                contratos!inner (
                    id_locatario,
                    recorrencia,
                    locatarios (
                        nome_completo,
                        whatsapp
                    )
                ),
                usuarios!inner (
                    id,
                    access_token_mercado_pago,
                    evolution_url,
                    evolution_instance,
                    evolution_apikey
                )
            `)
            .eq('status', 'pendente')
            .eq('data_vencimento', hoje)

        if (fetchError) throw fetchError

        if (!cobrancas || cobrancas.length === 0) {
            console.log("Nenhuma cobrança encontrada.")
            return new Response(
                JSON.stringify({ message: 'Sem cobranças para processar agora.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const results = []

        // 🔁 Processamento
        for (const cobranca of cobrancas) {
            try {
                const locatario = cobranca.contratos.locatarios
                const usuario = cobranca.usuarios
                const proximaTentativa = (cobranca.tentativas_envio || 0) + 1
                const primeiroNome = locatario.nome_completo.split(' ')[0]

                console.log(`Analisando cobrança ${cobranca.id} (Envio: ${proximaTentativa})`)

                // --- 🧠 LÓGICA DE ESPAÇAMENTO DINÂMICO ---
                // 1. Pega total de templates deste usuário
                const { count: totalTemplates } = await supabase
                    .from('mensagens_template')
                    .select('*', { count: 'exact', head: true })
                    .eq('id_usuario', usuario.id);

                if (!totalTemplates) {
                    console.log(`Locador ${usuario.id} não possui templates cadastrados.`);
                    continue;
                }

                // 2. Descobre tempo de expiração no contrato (JSON recorrencia)
                let horasExpiracao = 4; // Default caso não ache
                try {
                    const config = JSON.parse(cobranca.contratos.recorrencia);
                    horasExpiracao = Number(config.expiracao) || 4;
                } catch (e) { /* Legado */ }

                // 3. Calcula o intervalo ideal para este cliente
                const intervaloMs = (horasExpiracao * 60 * 60 * 1000) / totalTemplates;
                const tempoDesdeCriacao = agora.getTime() - new Date(cobranca.created_at).getTime();

                // 4. Quantos envios "já deveriam" ter ocorrido?
                const metaEnvios = Math.floor(tempoDesdeCriacao / intervaloMs);

                // --- 🛡️ TRAVAS DE SEGURANÇA ---
                // a) Já é hora do próximo lembrete?
                if (metaEnvios < proximaTentativa) {
                    console.log(`Aguardando próximo intervalo para ${cobranca.id}.`);
                    continue;
                }

                // b) Já enviou todas as mensagens da régua?
                if (proximaTentativa > totalTemplates) {
                    console.log(`Fim da régua para ${cobranca.id}.`);
                    continue;
                }

                // c) Proteção Anti-Cron: Não enviar 2 vezes em menos de 15 min
                const tempoUltimoEnvio = cobranca.ultimo_lembrete_at
                    ? (agora.getTime() - new Date(cobranca.ultimo_lembrete_at).getTime())
                    : Infinity;

                if (tempoUltimoEnvio < (15 * 60 * 1000)) {
                    console.log(`Segurança: Ignorando reenvio rápido para ${cobranca.id}.`);
                    continue;
                }

                // 🔎 Verificação no Mercado Pago antes de incomodar o cliente
                const mpResponse = await fetch(
                    `https://api.mercadopago.com/v1/payments/${cobranca.mercado_pago_id}`,
                    { headers: { 'Authorization': `Bearer ${usuario.access_token_mercado_pago}` } }
                )

                if (mpResponse.ok) {
                    const mpData = await mpResponse.json()
                    if (mpData.status === 'approved') {
                        console.log(`Cobrança ${cobranca.id} paga no MP.`)
                        await supabase.from('cobrancas').update({ status: 'pago', data_pagamento: agora.toISOString() }).eq('id', cobranca.id)
                        results.push({ id: cobranca.id, status: 'skipped_paid' })
                        continue
                    }
                }

                // 🔎 Busca template da vez
                const { data: template } = await supabase
                    .from('mensagens_template')
                    .select('conteudo')
                    .eq('id_usuario', usuario.id)
                    .eq('ordem', proximaTentativa)
                    .single()

                if (!template) {
                    console.log(`Fim da régua para ${locatario.nome_completo}`)
                    continue
                }

                // ✉️ Montagem da mensagem
                let mensagemFinal = `Olá, ${primeiroNome}! 🚗\n\n${template.conteudo}`

                if (cobranca.payment_link) {
                    mensagemFinal += `\n\n*VALOR:* R$ ${Number(cobranca.valor).toFixed(2).replace('.', ',')}`
                    mensagemFinal += `\n*LINK PIX:* ${cobranca.payment_link}`
                }

                // 📤 Envio Evolution API
                const evoResponse = await fetch(
                    `${usuario.evolution_url}/message/sendText/${usuario.evolution_instance}`,
                    {
                        method: 'POST',
                        headers: { 'apikey': usuario.evolution_apikey, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ number: locatario.whatsapp, text: mensagemFinal, delay: 1200 })
                    }
                )

                if (!evoResponse.ok) throw new Error("Falha no envio Evolution")

                // 🔄 Atualiza tentativa e marca horário do envio
                await supabase
                    .from('cobrancas')
                    .update({
                        tentativas_envio: proximaTentativa,
                        ultimo_lembrete_at: agora.toISOString()
                    })
                    .eq('id', cobranca.id)

                results.push({ id: cobranca.id, status: 'sent', tentativa: proximaTentativa })

            } catch (innerError) {
                console.error(`Erro na cobrança ${cobranca.id}:`, innerError.message)
                results.push({ id: cobranca.id, status: 'error' })
            }
        }

        return new Response(
            JSON.stringify({ processed: results }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error) {
        console.error("Erro geral:", error.message)
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
    }
})
