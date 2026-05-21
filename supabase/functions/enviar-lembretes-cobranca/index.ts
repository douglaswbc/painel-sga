import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        console.log("=== INÍCIO RÉGUA DINÂMICA DE COBRANÇA ===")

        const agora = new Date()

        // Data de hoje no fuso de Brasília (yyyy-mm-dd)
        const brasiliaTime = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(agora)

        const [dia, mes, ano] = brasiliaTime.split('/')
        const hoje = `${ano}-${mes}-${dia}`

        // Busca cobranças pendentes do dia.
        // Fix 1 (Trava de horário): `.lte('created_at', agora)` garante que só
        // processamos cobranças cujo created_at já passou — como o faturamento agora
        // cria a cobrança exatamente no horário do contrato, isso impede qualquer
        // lembrete ser enviado antes do horário definido.
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
                    status,
                    recorrencia,
                    locatarios (
                        nome_completo,
                        whatsapp
                    ),
                    usuarios (
                        id,
                        nome_completo,
                        access_token_mercado_pago,
                        evolution_url,
                        evolution_instance,
                        evolution_apikey
                    )
                )
            `)
            .eq('status', 'pendente')
            .eq('data_vencimento', hoje)
            .lte('created_at', agora.toISOString())  // Fix 1: só cobra após o horário do contrato
            .eq('contratos.status', 'ativo')          // Ignora cobranças de contratos inativos/encerrados

        if (fetchError) throw fetchError

        if (!cobrancas || cobrancas.length === 0) {
            console.log("Nenhuma cobrança elegível para envio agora.")
            return new Response(
                JSON.stringify({ message: 'Sem cobranças para processar agora.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const results: { id: string; status: string; tentativa?: number; msg?: string }[] = []

        for (const cobranca of cobrancas) {
            let locatarioNome = "Desconhecido"
            let locadorNome = "Desconhecido"
            try {
                // Ajuste defensivo: garante que pegamos objetos mesmo se o Supabase retornar arrays
                const contrato = Array.isArray(cobranca.contratos) ? cobranca.contratos[0] : cobranca.contratos
                if (!contrato) {
                    console.error(`Contrato não encontrado para cobrança ${cobranca.id}`)
                    continue
                }

                const locatario = Array.isArray(contrato.locatarios) ? contrato.locatarios[0] : contrato.locatarios
                const usuario = Array.isArray(contrato.usuarios) ? contrato.usuarios[0] : contrato.usuarios

                if (!locatario || !usuario) {
                    console.error(`Dados incompletos (locatário/usuário) para cobrança ${cobranca.id}`)
                    continue
                }

                locatarioNome = locatario.nome_completo
                locadorNome = usuario.nome_completo || usuario.id

                const proximaTentativa = (cobranca.tentativas_envio || 0) + 1
                const primeiroNome = locatario.nome_completo?.split(' ')[0] ?? 'Locatário'
                const whatsappLimpo = locatario.whatsapp.replace(/\D/g, '')

                console.log(`Analisando cobrança ${cobranca.id} | Locador: ${locadorNome} | Locatário: ${locatarioNome} | Tentativa: ${proximaTentativa}`)

                // Fix 1 (camada extra): Nunca processar cobrança criada no futuro
                if (new Date(cobranca.created_at) > agora) {
                    console.log(`Cobrança ${cobranca.id} ainda não chegou seu horário.`)
                    continue
                }

                // 1. Pega total de templates deste locador
                const { count: totalTemplates, error: countError } = await supabase
                    .from('mensagens_template')
                    .select('*', { count: 'exact', head: true })
                    .eq('id_usuario', usuario.id)
                    .eq('tipo', 'cobranca')

                if (countError || totalTemplates === null || totalTemplates === 0) {
                    console.log(`Locador ${locadorNome} (${usuario.id}) não possui templates cadastrados.`)
                    continue
                }

                // Trava a) Já enviou todos os lembretes da régua?
                if (proximaTentativa > totalTemplates) {
                    console.log(`Fim da régua para ${cobranca.id} (${locatarioNome}) — todos os ${totalTemplates} templates já enviados.`)
                    continue
                }

                // Trava b) Anti-Cron: não enviar 2x em menos de 15 min (protege contra runs sobrepostos)
                const tempoUltimoEnvio = cobranca.ultimo_lembrete_at
                    ? agora.getTime() - new Date(cobranca.ultimo_lembrete_at).getTime()
                    : Infinity

                if (tempoUltimoEnvio < 15 * 60 * 1000) {
                    console.log(`Segurança: ignorando reenvio rápido para ${cobranca.id} (${locatarioNome}) (${Math.round(tempoUltimoEnvio / 1000)}s desde último envio).`)
                    continue
                }


                // Verificação no Mercado Pago antes de incomodar o cliente
                const mpResponse = await fetch(
                    `https://api.mercadopago.com/v1/payments/${cobranca.mercado_pago_id}`,
                    { headers: { 'Authorization': `Bearer ${usuario.access_token_mercado_pago}` } }
                )

                if (mpResponse.ok) {
                    const mpData = await mpResponse.json()
                    if (mpData.status === 'approved') {
                        console.log(`Cobrança ${cobranca.id} (${locatarioNome}) já paga no MP — marcando como pago.`)
                        await supabase
                            .from('cobrancas')
                            .update({ status: 'pago', data_pagamento: agora.toISOString() })
                            .eq('id', cobranca.id)
                        results.push({ id: cobranca.id, status: 'skipped_paid' })
                        continue
                    }
                }

                // Busca template da vez (por ordem)
                const { data: template } = await supabase
                    .from('mensagens_template')
                    .select('conteudo, media_url, media_type, media_mimetype, media_filename')
                    .eq('id_usuario', usuario.id)
                    .eq('tipo', 'cobranca')
                    .eq('ordem', proximaTentativa)
                    .single()

                if (!template) {
                    console.log(`Template nº${proximaTentativa} não encontrado para locador ${locadorNome} — fim da régua.`)
                    continue
                }

                // Montagem da mensagem
                let mensagemFinal = `Olá, ${primeiroNome}! 🚗\n\n${template.conteudo}`

                if (cobranca.payment_link) {
                    mensagemFinal += `\n\n*VALOR:* R$ ${Number(cobranca.valor).toFixed(2).replace('.', ',')}`
                    mensagemFinal += `\n*LINK PIX:* ${cobranca.payment_link}`
                }

                // Envio via Evolution API
                const isMedia = !!template.media_url
                const endpoint = isMedia ? 'sendMedia' : 'sendText'
                const payload = isMedia ? {
                    number: whatsappLimpo,
                    mediatype: template.media_type,
                    mimetype: template.media_mimetype,
                    caption: mensagemFinal,
                    media: template.media_url,
                    fileName: template.media_filename,
                    delay: 1200,
                } : {
                    number: whatsappLimpo,
                    text: mensagemFinal,
                    delay: 1200,
                }

                const evoResponse = await fetch(
                    `${usuario.evolution_url}/message/${endpoint}/${usuario.evolution_instance}`,
                    {
                        method: 'POST',
                        headers: { 'apikey': usuario.evolution_apikey, 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    }
                )

                // Fix 5: incluir status HTTP no erro do Evolution
                if (!evoResponse.ok) {
                    const evoBody = await evoResponse.text().catch(() => '')
                    throw new Error(`Falha no envio Evolution [${evoResponse.status}]: ${evoBody}`)
                }

                // Fix 3: capturar erro do update de tentativas
                const { error: updateError } = await supabase
                    .from('cobrancas')
                    .update({
                        tentativas_envio: proximaTentativa,
                        ultimo_lembrete_at: agora.toISOString(),
                    })
                    .eq('id', cobranca.id)

                if (updateError) {
                    console.error(`Erro ao atualizar tentativas da cobrança ${cobranca.id} (${locatarioNome}): ${updateError.message}`)
                    // Não lança — o envio já ocorreu; log é suficiente
                }

                console.log(`Cobrança ${cobranca.id} | Locador: ${locadorNome} | Lembrete ${proximaTentativa}/${totalTemplates} enviado para ${locatarioNome} (${whatsappLimpo}).`)
                results.push({ id: cobranca.id, status: 'sent', tentativa: proximaTentativa })

            } catch (innerError) {
                const msg = innerError instanceof Error ? innerError.message : String(innerError)
                console.error(`Erro na cobrança ${cobranca.id} | Locador: ${locadorNome} | Locatário: ${locatarioNome}:`, msg)
                results.push({ id: cobranca.id, status: 'error', msg })
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
