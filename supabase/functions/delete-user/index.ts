// Arquivo da Edge Function: delete-user (VERSÃO FINAL E COMPLETA)

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

        // 1. Busca os dados do usuário para obter as informações da instância
        const { data: userToDelete, error: userError } = await supabaseAdmin
            .from('usuarios')
            .select('evolution_instance, evolution_url')
            .eq('id', userId)
            .single();

        if (userError) {
            console.warn(`Aviso: Usuário ${userId} não encontrado na tabela 'usuarios', mas a exclusão do Auth prosseguirá.`);
        }

        // 2. Deleta a instância na Evolution API, se as informações existirem
        const ADMIN_EVO_APIKEY = Deno.env.get('ADMIN_EVOLUTION_APIKEY');
        if (userToDelete && userToDelete.evolution_url && userToDelete.evolution_instance && ADMIN_EVO_APIKEY) {
            try {
                await fetch(`${userToDelete.evolution_url}/instance/delete/${userToDelete.evolution_instance}`, {
                    method: 'DELETE',
                    headers: { 'apikey': ADMIN_EVO_APIKEY }
                });
                console.log(`Instância ${userToDelete.evolution_instance} da Evolution API foi deletada.`);
            } catch (evoError) {
                console.error(`Falha ao deletar a instância da Evolution API para o usuário ${userId}:`, evoError.message);
            }
        }

        // --- CORREÇÃO APLICADA AQUI ---
        // 3. Deleta o perfil do usuário da sua tabela 'public.usuarios'
        // A regra "ON DELETE CASCADE" nas outras tabelas (contratos, cobranças) será acionada a partir daqui.
        const { error: profileError } = await supabaseAdmin
            .from('usuarios')
            .delete()
            .eq('id', userId);
        if (profileError) throw profileError;
        console.log(`Perfil do usuário ${userId} deletado da tabela 'usuarios'.`);


        // 4. Deleta o usuário do sistema de autenticação do Supabase
        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);
        // Ignoramos o erro "User not found" caso o perfil exista mas o auth user já tenha sido removido
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