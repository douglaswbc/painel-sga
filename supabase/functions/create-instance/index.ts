import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RYZE_URL = () => Deno.env.get('RYZE_API_URL') || 'https://ryzeapi.cloud/api'

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { instanceName, userId } = await req.json();

        if (!instanceName) throw new Error("Nome da instância é obrigatório.");
        if (!userId) throw new Error("ID do usuário é obrigatório.");

        const ADMIN_TOKEN = Deno.env.get('RYZE_ADMIN_TOKEN');
        if (!ADMIN_TOKEN) throw new Error("RYZE_ADMIN_TOKEN não configurado.");

        const WEBHOOK_URL = Deno.env.get('URL_WEBHOOK_FECHADURA');

        const ryzeResponse = await fetch(`${RYZE_URL()}/instance/new`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': ADMIN_TOKEN
            },
            body: JSON.stringify({
                name: instanceName,
                webhookEnabled: !!WEBHOOK_URL,
                webhookURL: WEBHOOK_URL || undefined,
                webhookEvents: ["message.exchange"],
                webhookMediaBase64: true
            })
        });

        let instance;

        if (ryzeResponse.ok) {
            const ryzeData = await ryzeResponse.json();
            instance = ryzeData.instance;
        } else if (ryzeResponse.status === 409) {
            const listResponse = await fetch(`${RYZE_URL()}/instance/list?instanceName=${encodeURIComponent(instanceName)}`, {
                headers: { 'token': ADMIN_TOKEN }
            });

            if (!listResponse.ok) {
                const errText = await listResponse.text();
                throw new Error(`RyzeAPI error [${listResponse.status}]: ${errText}`);
            }

            const listData = await listResponse.json();
            if (!listData.instances || listData.instances.length === 0) {
                throw new Error("Instância já existe mas não foi possível recuperá-la.");
            }

            instance = listData.instances[0];
            console.log(`Instância ${instanceName} já existia, reutilizando token.`);
        } else {
            const errText = await ryzeResponse.text();
            throw new Error(`RyzeAPI error [${ryzeResponse.status}]: ${errText}`);
        }

        if (!instance || !instance.token) {
            throw new Error("Token da instância não encontrado.");
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { error: updateError } = await supabaseAdmin
            .from('usuarios')
            .update({
                ryze_instance: instance.name
            })
            .eq('id', userId);

        if (updateError) throw new Error(`Erro ao salvar instância: ${updateError.message}`);

        try {
            const { error: vaultError } = await supabaseAdmin.rpc('create_user_ryze_secret', {
                p_user_id: userId,
                p_token: instance.token
            });
            if (vaultError) console.error("Falha ao salvar token no Vault:", vaultError.message);
        } catch (e) {
            console.error("Falha ao salvar token no Vault:", e.message);
        }

        return new Response(JSON.stringify({
            success: true,
            instance: instance.name,
            token: instance.token,
            message: "Instância criada e vinculada ao seu perfil com sucesso!"
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
