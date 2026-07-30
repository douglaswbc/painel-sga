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
        const payload = await req.json()
        console.log("=== WEBHOOK FECHADURA RECEBIDO (RyzeAPI) ===")

        const data = Array.isArray(payload) ? payload[0] : payload
        const body = data.body || data

        const messageContent = body.data?.message?.content || ""
        const remoteJid = body.data?.chat?.jid || body.data?.sender?.jid || ""
        const direction = body.data?.direction || "incoming"
        const chatType = body.data?.chat?.type || "private"
        const rawSender = remoteJid.split('@')[0] || ""
        const instanceName = body.instanceData?.instance || data.instanceData?.instance || ""

        if (direction === 'outgoing' || direction !== 'incoming') {
            console.log("Mensagem ignorada: outgoing ou direção não-incoming.", { direction })
            return new Response(JSON.stringify({ status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        if (chatType !== 'private' || remoteJid.includes('@g.us')) {
            console.log("Mensagem ignorada: grupo ou não-privado.", { chatType, remoteJid })
            return new Response(JSON.stringify({ status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        if (!messageContent || !rawSender || !instanceName) {
            console.log("Payload incompleto. Ignorando.", { message: !!messageContent, sender: !!rawSender, instance: !!instanceName })
            return new Response(JSON.stringify({ status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const senderVariants = normalizePhoneNumber(rawSender)
        console.log(`Mensagem de: ${rawSender} (Variantes: ${senderVariants.join(", ")}) na instância: ${instanceName}`)

        const { data: usuario, error: userError } = await supabase
            .from('usuarios')
            .select('id, ryze_instance')
            .eq('ryze_instance', instanceName)
            .single()

        if (userError || !usuario) {
            console.error("Locador não encontrado para instância:", instanceName)
            return new Response('Locador não encontrado', { status: 404 })
        }

        const { data: ryzeToken } = await supabase.rpc('get_user_ryze_token', { p_user_id: usuario.id });
        usuario.ryze_token = ryzeToken || '';

        const cleanMsg = messageContent.trim().toLowerCase()

        if (cleanMsg.startsWith("abrir")) {
            const identificador = cleanMsg.replace("abrir", "").trim()
            
            const { data: fechadura, error: fError } = await supabase
                .from('fechaduras')
                .select('id, nome')
                .eq('id_usuario', usuario.id)
                .eq('identificador', identificador)
                .single()

            if (fError || !fechadura) {
                console.log(`Porta "${identificador}" não encontrada para o locador ${usuario.id}`)
                await sendWhatsApp(usuario, rawSender, `⚠️ Porta "${identificador}" não encontrada.`)
                return new Response('ok')
            }

            const { data: locatario, error: lError } = await supabase
                .from('locatarios')
                .select('id, nome_completo, ativo')
                .eq('id_usuario', usuario.id)
                .in('whatsapp', senderVariants)
                .eq('ativo', true)
                .limit(1)
                .maybeSingle()

            if (lError || !locatario) {
                console.log(`Acesso negado para ${rawSender}. Locatário não encontrado ou inativo.`)
                await sendWhatsApp(usuario, rawSender, "❌ Você não tem autorização para abrir esta porta ou seu cadastro está inativo.")
                return new Response('ok')
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString()
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() 

            await supabase.from('fechadura_verificacoes').delete().in('whatsapp', senderVariants)
            
            await supabase.from('fechadura_verificacoes').insert({
                whatsapp: rawSender,
                id_fechadura: fechadura.id,
                codigo_otp: otp,
                expires_at: expiresAt
            })

            await supabase.from('fechadura_logs').insert({
                id_usuario: usuario.id,
                id_locatario: locatario.id,
                id_fechadura: fechadura.id,
                whatsapp: rawSender,
                evento: 'solicitado',
                detalhes: `Solicitou abertura da porta: ${fechadura.nome}`
            })

            await sendWhatsApp(usuario, rawSender, `🔐 *Solicitação de Abertura*\nPorta: ${fechadura.nome}\n\nPara confirmar, responda apenas com o código de 6 dígitos: *${otp}*`)
            
            return new Response('ok')
        }

        if (/^\d{6}$/.test(cleanMsg)) {
            const { data: verificacao, error: vError } = await supabase
                .from('fechadura_verificacoes')
                .select('*, fechaduras(nome, id_usuario)')
                .eq('whatsapp', rawSender)
                .gt('expires_at', new Date().toISOString())
                .single()

            if (vError || !verificacao) {
                return new Response('ok')
            }

            if (verificacao.codigo_otp === cleanMsg) {
                const token = Math.random().toString(36).substring(2, 10).toUpperCase()
                const expiresAt = new Date(Date.now() + 60 * 1000).toISOString()

                await supabase.from('fechadura_comandos').insert({
                    id_fechadura: verificacao.id_fechadura,
                    token_acesso: token,
                    expires_at: expiresAt
                })

                await supabase.from('fechadura_verificacoes').delete().eq('id', verificacao.id)

                await supabase.from('fechadura_logs').insert({
                    id_usuario: usuario.id,
                    id_fechadura: verificacao.id_fechadura,
                    whatsapp: rawSender,
                    evento: 'otp_validado',
                    detalhes: `Acesso autorizado para a porta: ${verificacao.fechaduras.nome}`
                })

                await sendWhatsApp(usuario, rawSender, "✅ *Acesso Autorizado!*\nA porta será liberada agora. Você tem 1 minuto.")
            } else {
                await sendWhatsApp(usuario, rawSender, "❌ Código incorreto. Tente novamente ou peça um novo código.")
            }
            
            return new Response('ok')
        }

        return new Response(JSON.stringify({ status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    } catch (error) {
        console.error("ERRO WEBHOOK:", error.message)
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }
})

function normalizePhoneNumber(phone: string): string[] {
    const clean = phone.replace(/\D/g, "")
    const variants = [clean]

    if (clean.startsWith("55") && clean.length === 12) {
        const ddd = clean.substring(2, 4)
        const number = clean.substring(4)
        variants.push(`55${ddd}9${number}`)
    } else if (clean.startsWith("55") && clean.length === 13) {
        const ddd = clean.substring(2, 4)
        const number = clean.substring(5)
        variants.push(`55${ddd}${number}`)
    }

    return variants
}

async function sendWhatsApp(usuario: any, phone: string, text: string) {
    try {
        const RYZE_URL = Deno.env.get('RYZE_API_URL') || 'https://ryzeapi.cloud/api'
        const hasLink = /https?:\/\/\S+/i.test(text);
        const response = await fetch(`${RYZE_URL}/message/text/${usuario.ryze_instance}`, {
            method: 'POST',
            headers: { 'token': usuario.ryze_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                number: phone,
                message: text,
                delay: 3,
                linkPreview: hasLink
            })
        })
        if (!response.ok) {
            console.error("Falha ao enviar WHATSAPP:", await response.text())
        }
    } catch (e) {
        console.error("Erro ao enviar mensagem:", e)
    }
}
