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
        console.log("=== INÍCIO AGENDADOR MENSAGENS AVULSAS ===")

        const agora = new Date()
        const brDateString = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))

        const ano = brDateString.getFullYear()
        const mes = String(brDateString.getMonth() + 1).padStart(2, '0')
        const dia = String(brDateString.getDate()).padStart(2, '0')
        const hoje = `${ano}-${mes}-${dia}`

        const horaAtual = `${String(brDateString.getHours()).padStart(2, '0')}:${String(brDateString.getMinutes()).padStart(2, '0')}:00`

        const { data: agendamentos, error: fetchError } = await supabase
            .from('agendamentos_mensagens')
            .select(`
                id,
                frequencia,
                frequencia_dias,
                proximo_envio,
                horario_envio,
                mensagens_template!inner (
                    conteudo,
                    media_url,
                    media_type,
                    media_mimetype,
                    media_filename
                ),
                locatarios!inner (
                    id,
                    nome_completo,
                    whatsapp
                ),
                contratos!inner (
                    id,
                    status
                ),
                usuarios!inner (
                    id,
                    evolution_url,
                    evolution_instance,
                    evolution_apikey
                )
            `)
            .eq('ativo', true)
            .eq('contratos.status', 'ativo') // ✅ filtro correto
            .lte('proximo_envio', hoje)

        if (fetchError) throw fetchError

        if (!agendamentos || agendamentos.length === 0) {
            console.log("Nenhum agendamento para processar agora.")
            return new Response(
                JSON.stringify({ message: 'Sem agendamentos.' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const results = []

        for (const ag of agendamentos) {
            try {
                if (ag.proximo_envio === hoje && ag.horario_envio && ag.horario_envio > horaAtual) {
                    console.log(`[AGUARDANDO] Agendamento ${ag.id} para ${ag.horario_envio}`)
                    continue
                }

                const locatario = ag.locatarios
                const contratos = ag.contratos

                // 🔒 segurança extra (caso algo passe no filtro)
                if (!contratos || contratos.length === 0) {
                    console.log(`[IGNORADO] Sem contrato ativo: ${locatario.nome_completo}`)
                    continue
                }

                const usuario = ag.usuarios
                const template = ag.mensagens_template

                const primeiroNome = locatario.nome_completo?.split(' ')[0] ?? 'Cliente'
                const content = template.conteudo.replace(/{nome}/g, primeiroNome)

                const isMedia = !!template.media_url
                const endpoint = isMedia ? 'sendMedia' : 'sendText'

                const payload = isMedia ? {
                    number: locatario.whatsapp.replace(/\D/g, ''),
                    mediatype: template.media_type,
                    mimetype: template.media_mimetype,
                    caption: content,
                    media: template.media_url,
                    fileName: template.media_filename,
                    delay: 1200,
                } : {
                    number: locatario.whatsapp.replace(/\D/g, ''),
                    text: content,
                    delay: 1200,
                }

                const evoResponse = await fetch(
                    `${usuario.evolution_url}/message/${endpoint}/${usuario.evolution_instance}`,
                    {
                        method: 'POST',
                        headers: {
                            'apikey': usuario.evolution_apikey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload),
                    }
                )

                if (!evoResponse.ok) {
                    const evoBody = await evoResponse.text().catch(() => '')
                    throw new Error(`Falha no envio Evolution [${evoResponse.status}]: ${evoBody}`)
                }

                // 📅 próximo envio
                let proximaData = new Date()

                if (ag.frequencia === 'diario') proximaData.setDate(proximaData.getDate() + 1)
                else if (ag.frequencia === 'semanal') proximaData.setDate(proximaData.getDate() + 7)
                else if (ag.frequencia === 'quinzenal') proximaData.setDate(proximaData.getDate() + 15)
                else if (ag.frequencia === 'mensal') proximaData.setMonth(proximaData.getMonth() + 1)
                else if (ag.frequencia === 'personalizado' && ag.frequencia_dias) {
                    proximaData.setDate(proximaData.getDate() + ag.frequencia_dias)
                }

                const proxAno = proximaData.getFullYear()
                const proxMes = String(proximaData.getMonth() + 1).padStart(2, '0')
                const proxDia = String(proximaData.getDate()).padStart(2, '0')
                const novaDataFormato = `${proxAno}-${proxMes}-${proxDia}`

                const { error: updateError } = await supabase
                    .from('agendamentos_mensagens')
                    .update({ proximo_envio: novaDataFormato })
                    .eq('id', ag.id)

                if (updateError) throw updateError

                console.log(`Mensagem enviada para ${locatario.whatsapp}`)

                results.push({
                    id: ag.id,
                    status: 'sent',
                    proximo_envio: novaDataFormato
                })

            } catch (innerError) {
                const msg = innerError instanceof Error ? innerError.message : String(innerError)
                console.error(`Erro no agendamento ${ag.id}:`, msg)

                results.push({
                    id: ag.id,
                    status: 'error',
                    msg
                })
            }
        }

        return new Response(
            JSON.stringify({ processed: results }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        console.error("Erro geral:", error.message)

        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500
            }
        )
    }
})