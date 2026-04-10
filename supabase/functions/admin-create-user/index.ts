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

        // 1. Criar Usuário no Auth do Supabase
        // O metadata será capturado pelo trigger 'handle_new_user' no banco
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

        // 2. Atualizar Perfil na tabela 'public.usuarios'
        // NOTA: O trigger já inseriu o registro, então usamos UPDATE para evitar "duplicate key"
        const updatePayload: any = {
            whatsapp: whatsapp || null,
            ativo: true
        }

        // 3. Lógica específica para Locador (Criação de Instância na Evolution API)
        if (role === 'locador' && instanceName) {
            const EVO_URL = Deno.env.get('ADMIN_EVOLUTION_URL')
            const ADMIN_APIKEY = Deno.env.get('ADMIN_EVOLUTION_APIKEY')

            if (!ADMIN_APIKEY) {
                console.error("ADMIN_EVOLUTION_APIKEY não configurado nas variáveis de ambiente.")
            } else {
                try {
                    // Chamada para criar instância
                    const evoResponse = await fetch(`${EVO_URL}/instance/create`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': ADMIN_APIKEY
                        },
                        body: JSON.stringify({
                            instanceName: instanceName,
                            token: Math.random().toString(36).substring(2, 12),
                            integration: "WHATSAPP-BAILEYS",
                            webhook: {
                                url: Deno.env.get('URL_WEBHOOK_FECHADURA'),
                                base64: true,
                                events: [
                                    "MESSAGES_UPSERT"
                                ]
                            }
                        })
                    })

                    if (evoResponse.ok) {
                        const evoData = await evoResponse.json()
                        updatePayload.evolution_instance = evoData.instance.instanceName
                        updatePayload.evolution_apikey = evoData.hash.apikey
                        updatePayload.evolution_url = EVO_URL
                        console.log(`Instância ${instanceName} criada com sucesso.`)
                    } else {
                        const errText = await evoResponse.text()
                        console.error(`Erro ao criar instância na Evolution: ${errText}`)
                    }
                } catch (evoErr) {
                    console.error("Falha na comunicação com Evolution API:", evoErr.message)
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
            instanceName: updatePayload.evolution_instance || null
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
