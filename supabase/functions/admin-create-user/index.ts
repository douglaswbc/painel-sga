import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    try {
        const { email, password, nome_completo, role, whatsapp, instanceName } = await req.json()

        if (!email || !password || !role) {
            throw new Error("E-mail, senha e cargo são obrigatórios.")
        }

        console.log(`Criando usuário: ${email} com cargo ${role}`)

        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                nome_completo,
                role
            }
        })

        if (authError) throw authError
        const userId = authUser.user.id

        const updatePayload: any = {
            whatsapp: whatsapp || null,
            ativo: true
        }

        if (role === 'locador' && instanceName) {
            const EVOLUTION_URL = Deno.env.get('EVOLUTION_API_URL')
            const API_KEY = Deno.env.get('EVOLUTION_API_KEY')

            if (!API_KEY) {
                console.error("EVOLUTION_API_KEY não configurado nas variáveis de ambiente.")
            } else {
                try {
                    const WEBHOOK_URL = Deno.env.get('URL_WEBHOOK_FECHADURA');
                    const body: any = {
                        instanceName,
                        integration: "WHATSAPP-BAILEYS"
                    };
                    if (WEBHOOK_URL) {
                        body.webhook = {
                            url: WEBHOOK_URL,
                            base64: true,
                            events: ["MESSAGES_UPSERT"]
                        };
                    }

                    const evolutionResponse = await fetch(`${EVOLUTION_URL}/instance/create`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': API_KEY
                        },
                        body: JSON.stringify(body)
                    })

                    if (evolutionResponse.ok) {
                        const evolutionData = await evolutionResponse.json()
                        const inst = evolutionData.instance || evolutionData
                        updatePayload.ryze_instance = inst.instanceName || inst.name || instanceName
                        console.log(`Instância ${instanceName} criada com sucesso na Evolution API.`)
                    } else {
                        const errText = await evolutionResponse.text()
                        console.error(`Erro ao criar instância na Evolution API: ${errText}`)
                    }
                } catch (evolutionErr) {
                    console.error("Falha na comunicação com Evolution API:", evolutionErr.message)
                }
            }
        }

        const { error: updateError } = await supabaseAdmin
            .from('usuarios')
            .update(updatePayload)
            .eq('id', userId)

        if (updateError) throw updateError

        return new Response(JSON.stringify({
            success: true,
            userId: userId,
            instanceName: updatePayload.ryze_instance || null
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        })

    } catch (error) {
        console.error("ERRO admin-create-user:", error.message)
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        })
    }
})
