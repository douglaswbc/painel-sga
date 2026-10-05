// Arquivo da Edge Function: delete-user

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error("Autenticação obrigatória.");

        const supabaseCaller = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        );
        const { data: { user }, error: callerAuthError } = await supabaseCaller.auth.getUser();
        if (callerAuthError || !user) throw new Error("Usuário não autenticado.");

        const { data: callerProfile, error: callerProfileError } = await supabaseCaller
            .from('usuarios')
            .select('role')
            .eq('id', user.id)
            .single();
        if (callerProfileError || callerProfile?.role !== 'admin') {
            throw new Error("Acesso restrito a administradores.");
        }

        const { userId } = await req.json();
        if (!userId) throw new Error("ID do usuário não fornecido.");

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { error: profileError } = await supabaseAdmin
            .from('usuarios')
            .delete()
            .eq('id', userId);
        if (profileError) throw profileError;
        console.log(`Perfil do usuário ${userId} deletado da tabela 'usuarios'.`);


        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        if (authError && authError.message !== "User not found") {
            throw authError;
        }
        console.log(`Usuário ${userId} deletado do sistema de autenticação.`);

        return new Response(JSON.stringify({
            success: true,
            message: "Usuário e dados associados excluídos com sucesso."
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });
    } catch (error) {
        return new Response(JSON.stringify({
            error: error.message
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        });
    }
});
