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
        console.log("=== WEBHOOK FECHADURA RECEBIDO ===")
        
        // A Evolution API pode enviar o dado como objeto simples ou dentro de um array
        const data = Array.isArray(payload) ? payload[0] : payload
        const body = data.body || data
        
        // Extração robusta conforme o novo payload
        const message = body.data?.message?.conversation || body.data?.content || ""
        const remoteJid = body.data?.key?.remoteJid || body.sender || ""
        const fromMe = body.data?.key?.fromMe || false
        const rawSender = remoteJid.split('@')[0] || ""
        const instanceName = body.instance || data.instance
        
        // Filtros de segurança: Ignora mensagens do próprio bot ou de grupos
        if (fromMe || !remoteJid.includes('@s.whatsapp.net')) {
            console.log("Mensagem ignorada: fromMe ou Grupo.", { fromMe, remoteJid })
            return new Response(JSON.stringify({ status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        if (!message || !rawSender || !instanceName) {
            console.log("Payload incompleto. Ignorando.", { message: !!message, sender: !!rawSender, instance: !!instanceName })
            return new Response(JSON.stringify({ status: 'ignored' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        // 1. Normalização de Número (Brasil 12 vs 13 dígitos)
        // O banco sempre tem o 9, o WhatsApp pode omitir.
        const senderVariants = normalizePhoneNumber(rawSender)
        console.log(`Mensagem de: ${rawSender} (Variantes: ${senderVariants.join(", ")}) na instância: ${instanceName}`)

        // 2. Identificar o Dono (Locador) pela Instância
        const { data: usuario, error: userError } = await supabase
            .from('usuarios')
            .select('id, evolution_url, evolution_apikey, evolution_instance')
            .eq('evolution_instance', instanceName)
            .single()

        if (userError || !usuario) {
            console.error("Locador não encontrado para instância:", instanceName)
            return new Response('Locador não encontrado', { status: 404 })
        }

        const cleanMsg = message.trim().toLowerCase()

        // 3. Fluxo: SOLICITAÇÃO DE ABERTURA
        if (cleanMsg.startsWith("abrir")) {
            const identificador = cleanMsg.replace("abrir", "").trim()
            
            // Validar se a fechadura existe (escopado ao locador)
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

            // Validar se o remetente é um locatário ativo (usando variantes do número)
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

            // Gerar OTP
            const otp = Math.floor(100000 + Math.random() * 900000).toString()
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() 

            // Limpa verificações antigas deste número (qualquer variante)
            await supabase.from('fechadura_verificacoes').delete().in('whatsapp', senderVariants)
            
            await supabase.from('fechadura_verificacoes').insert({
                whatsapp: rawSender, // Salvamos o remetente original para responder de volta
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

        // 4. Fluxo: VALIDAÇÃO DE OTP
        if (/^\d{6}$/.test(cleanMsg)) {
            // Busca verificação pendente (o remetente deve coincidir)
            const { data: verificacao, error: vError } = await supabase
                .from('fechadura_verificacoes')
                .select('*, fechaduras(nome, id_usuario)')
                .eq('whatsapp', rawSender)
                .gt('expires_at', new Date().toISOString())
                .single()

            if (vError || !verificacao) {
                return new Response('ok') // Sem verificação pendente para este número exato
            }

            if (verificacao.codigo_otp === cleanMsg) {
                // Sucesso! Gerar comando de abertura
                const token = Math.random().toString(36).substring(2, 10).toUpperCase()
                const expiresAt = new Date(Date.now() + 60 * 1000).toISOString() // 1 minuto

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

// Função para lidar com números brasileiros de 12 e 13 dígitos
function normalizePhoneNumber(phone: string): string[] {
    const clean = phone.replace(/\D/g, "")
    const variants = [clean]

    // Se é um número brasileiro (55)
    if (clean.startsWith("55") && clean.length === 12) {
        // Ex: 559184463240 (12) -> Adiciona o 9: 5591984463240 (13)
        const ddd = clean.substring(2, 4)
        const number = clean.substring(4)
        variants.push(`55${ddd}9${number}`)
    } else if (clean.startsWith("55") && clean.length === 13) {
        // Ex: 5591984463240 (13) -> Versão sem o 9: 559184463240 (12)
        const ddd = clean.substring(2, 4)
        const number = clean.substring(5) // Pula o 9
        variants.push(`55${ddd}${number}`)
    }

    return variants
}

async function sendWhatsApp(usuario: any, phone: string, text: string) {
    try {
        const response = await fetch(`${usuario.evolution_url}/message/sendText/${usuario.evolution_instance}`, {
            method: 'POST',
            headers: { 'apikey': usuario.evolution_apikey, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                number: phone,
                text: text,
                delay: 1000
            })
        })
        if (!response.ok) {
            console.error("Falha ao enviar WHATSAPP:", await response.text())
        }
    } catch (e) {
        console.error("Erro ao enviar mensagem:", e)
    }
}
