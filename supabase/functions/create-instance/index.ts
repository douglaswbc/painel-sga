import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EVOLUTION_URL = () => Deno.env.get('EVOLUTION_API_URL') || '';

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { instanceName, userId } = await req.json();

        if (!instanceName) throw new Error("Nome da instância é obrigatório.");
        if (!userId) throw new Error("ID do usuário é obrigatório.");

        const API_KEY = Deno.env.get('EVOLUTION_API_KEY');
        if (!API_KEY) throw new Error("EVOLUTION_API_KEY não configurado.");

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

        const evolutionResponse = await fetch(`${EVOLUTION_URL()}/instance/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': API_KEY
            },
            body: JSON.stringify(body)
        });

        let instanceName_: string;

        if (evolutionResponse.ok) {
            const evolutionData = await evolutionResponse.json();
            const inst = evolutionData.instance || evolutionData;
            instanceName_ = inst.instanceName || inst.name || '';
        } else if (evolutionResponse.status === 409) {
            instanceName_ = instanceName;
            console.log(`Instância ${instanceName} já existia, reutilizando.`);
        } else {
            const errText = await evolutionResponse.text();
            throw new Error(`Evolution API error [${evolutionResponse.status}]: ${errText}`);
        }

        if (!instanceName_) {
            throw new Error("Nome da instância não encontrado na resposta.");
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { error: updateError } = await supabaseAdmin
            .from('usuarios')
            .update({
                ryze_instance: instanceName_
            })
            .eq('id', userId);

        if (updateError) throw new Error(`Erro ao salvar instância: ${updateError.message}`);

        return new Response(JSON.stringify({
            success: true,
            instance: instanceName_,
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
