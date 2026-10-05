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
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error("Autenticação obrigatória.")

        const supabaseCaller = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )
        const { data: { user }, error: callerAuthError } = await supabaseCaller.auth.getUser()
        if (callerAuthError || !user) throw new Error("Usuário não autenticado.")

        const { data: callerProfile, error: callerProfileError } = await supabaseCaller
            .from('usuarios')
            .select('role')
            .eq('id', user.id)
            .single()
        if (callerProfileError || callerProfile?.role !== 'admin') {
            throw new Error("Acesso restrito a administradores.")
        }

        const { email, password, nome_completo, role, whatsapp } = await req.json()

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
            ativo: true,
            // handle_new_user now assigns the safe default role. Only this
            // authenticated admin Edge Function may apply the requested role.
            role
        }

        const { error: updateError } = await supabaseAdmin
            .from('usuarios')
            .update(updatePayload)
            .eq('id', userId)

        if (updateError) throw updateError

        return new Response(JSON.stringify({
            success: true,
            userId: userId
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
