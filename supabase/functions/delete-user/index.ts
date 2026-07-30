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
        const { userId } = await req.json();
        if (!userId) throw new Error("ID do usuário não fornecido.");

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { data: userToDelete, error: userError } = await supabaseAdmin
            .from('usuarios')
            .select('ryze_instance')
            .eq('id', userId)
            .single();

        if (userError) {
            console.warn(`Aviso: Usuário ${userId} não encontrado na tabela 'usuarios', mas a exclusão do Auth prosseguirá.`);
        }

        const RYZE_URL = Deno.env.get('RYZE_API_URL');
        const ADMIN_TOKEN = Deno.env.get('RYZE_ADMIN_TOKEN');
        if (userToDelete && userToDelete.ryze_instance && ADMIN_TOKEN) {
            try {
                const ryzeResponse = await fetch(`${RYZE_URL}/instance/delete/${userToDelete.ryze_instance}`, {
                    method: 'DELETE',
                    headers: { 'token': ADMIN_TOKEN }
                });
                if (ryzeResponse.ok) {
                    console.log(`Instância ${userToDelete.ryze_instance} da RyzeAPI foi deletada.`);
                } else {
                    const errText = await ryzeResponse.text();
                    console.error(`Falha ao deletar instância RyzeAPI: ${errText}`);
                }
            } catch (ryzeError) {
                console.error(`Falha ao deletar a instância da RyzeAPI para o usuário ${userId}:`, ryzeError.message);
            }
        }

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
            message: "Usuário, instância e todos os dados associados foram excluídos com sucesso."
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
