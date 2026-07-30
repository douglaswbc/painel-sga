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
            const RYZE_URL = Deno.env.get('RYZE_API_URL')
            const ADMIN_TOKEN = Deno.env.get('RYZE_ADMIN_TOKEN')

            if (!ADMIN_TOKEN) {
                console.error("RYZE_ADMIN_TOKEN não configurado nas variáveis de ambiente.")
            } else {
                try {
                    const ryzeResponse = await fetch(`${RYZE_URL}/instance/new`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'token': ADMIN_TOKEN
                        },
                        body: JSON.stringify({
                            name: instanceName,
                            webhookEnabled: true,
                            webhookURL: Deno.env.get('URL_WEBHOOK_FECHADURA'),
                            webhookEvents: ["message.exchange"],
                            webhookMediaBase64: true
                        })
                    })

                    if (ryzeResponse.ok) {
                        const ryzeData = await ryzeResponse.json()
                        updatePayload.ryze_instance = ryzeData.instance?.name || instanceName
                        updatePayload._ryze_token_vault = ryzeData.instance?.token
                        console.log(`Instância ${instanceName} criada com sucesso na RyzeAPI.`)
                    } else {
                        const errText = await ryzeResponse.text()
                        console.error(`Erro ao criar instância na RyzeAPI: ${errText}`)
                    }
                } catch (ryzeErr) {
                    console.error("Falha na comunicação com RyzeAPI:", ryzeErr.message)
                }
            }
        }

        const { error: updateError } = await supabaseAdmin
            .from('usuarios')
            .update(updatePayload)
            .eq('id', userId)

        if (updateError) throw updateError

        if (updatePayload._ryze_token_vault) {
            try {
                const { error: vaultError } = await supabaseAdmin.rpc('create_user_ryze_secret', {
                    p_user_id: userId,
                    p_token: updatePayload._ryze_token_vault
                });
                if (vaultError) console.error("Falha ao salvar token no Vault:", vaultError.message);
            } catch (e) {
                console.error("Falha ao salvar token no Vault:", e.message);
            }
        }
        delete updatePayload._ryze_token_vault;

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
