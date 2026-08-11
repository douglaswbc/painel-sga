import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVOLUTION_URL = () => Deno.env.get('EVOLUTION_API_URL') || ''
const API_KEY = () => Deno.env.get('EVOLUTION_API_KEY') || ''

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

        const brasiliaTime = new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(agora)

        const [dia, mes, ano] = brasiliaTime.split('/')
        const hoje = `${ano}-${mes}-${dia}`

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
                        ryze_instance
                    )
                )
            `)
            .eq('status', 'pendente')
            .eq('data_vencimento', hoje)
            .lte('created_at', agora.toISOString())
            .eq('contratos.status', 'ativo')

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

                const { data: mpToken } = await supabase.rpc('get_user_mp_token', { p_user_id: usuario.id });
                usuario.access_token_mercado_pago = mpToken || '';

                locatarioNome = locatario.nome_completo
                locadorNome = usuario.nome_completo || usuario.id

                const proximaTentativa = (cobranca.tentativas_envio || 0) + 1
                const primeiroNome = locatario.nome_completo?.split(' ')[0] ?? 'Locatário'
                const whatsappLimpo = locatario.whatsapp.replace(/\D/g, '')

                console.log(`Analisando cobrança ${cobranca.id} | Locador: ${locadorNome} | Locatário: ${locatarioNome} | Tentativa: ${proximaTentativa}`)

                if (new Date(cobranca.created_at) > agora) {
                    console.log(`Cobrança ${cobranca.id} ainda não chegou seu horário.`)
                    continue
                }

                const { count: totalTemplates, error: countError } = await supabase
                    .from('mensagens_template')
                    .select('*', { count: 'exact', head: true })
                    .eq('id_usuario', usuario.id)
                    .eq('tipo', 'cobranca')

                if (countError || totalTemplates === null || totalTemplates === 0) {
                    console.log(`Locador ${locadorNome} (${usuario.id}) não possui templates cadastrados.`)
                    continue
                }

                if (proximaTentativa > totalTemplates) {
                    console.log(`Fim da régua para ${cobranca.id} (${locatarioNome}) — todos os ${totalTemplates} templates já enviados.`)
                    continue
                }

                const tempoUltimoEnvio = cobranca.ultimo_lembrete_at
                    ? agora.getTime() - new Date(cobranca.ultimo_lembrete_at).getTime()
                    : Infinity

                if (tempoUltimoEnvio < 15 * 60 * 1000) {
                    console.log(`Segurança: ignorando reenvio rápido para ${cobranca.id} (${locatarioNome}) (${Math.round(tempoUltimoEnvio / 1000)}s desde último envio).`)
                    continue
                }

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

                let mensagemFinal = `Olá, ${primeiroNome}! 🚗\n\n${template.conteudo}`

                if (cobranca.payment_link) {
                    mensagemFinal += `\n\n*VALOR:* R$ ${Number(cobranca.valor).toFixed(2).replace('.', ',')}`
                    mensagemFinal += `\n*LINK PIX:* ${cobranca.payment_link}`
                }

                const isMedia = !!template.media_url
                const endpoint = isMedia ? 'sendMedia' : 'sendText'
                const payload = isMedia ? {
                    number: whatsappLimpo,
                    mediatype: template.media_type,
                    mimetype: template.media_mimetype || 'image/jpeg',
                    caption: mensagemFinal,
                    media: template.media_url,
                    fileName: template.media_filename,
                    delay: 1200,
                } : {
                    number: whatsappLimpo,
                    text: mensagemFinal,
                    delay: 1200,
                    linkPreview: /https?:\/\/\S+/i.test(mensagemFinal)
                }

                const evolutionResponse = await fetch(
                    `${EVOLUTION_URL()}/message/${endpoint}/${usuario.ryze_instance}`,
                    {
                        method: 'POST',
                        headers: { 'apikey': API_KEY(), 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    }
                )

                if (!evolutionResponse.ok) {
                    const evolutionBody = await evolutionResponse.text().catch(() => '')
                    throw new Error(`Falha no envio Evolution API [${evolutionResponse.status}]: ${evolutionBody}`)
                }

                const { error: updateError } = await supabase
                    .from('cobrancas')
                    .update({
                        tentativas_envio: proximaTentativa,
                        ultimo_lembrete_at: agora.toISOString(),
                    })
                    .eq('id', cobranca.id)

                if (updateError) {
                    console.error(`Erro ao atualizar tentativas da cobrança ${cobranca.id} (${locatarioNome}): ${updateError.message}`)
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
