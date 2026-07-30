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
        const { instanceName } = await req.json();

        if (!instanceName) {
            throw new Error("Nome da instância não fornecido.");
        }

        const ADMIN_TOKEN = Deno.env.get('RYZE_ADMIN_TOKEN');
        if (!ADMIN_TOKEN) {
            throw new Error("RYZE_ADMIN_TOKEN não configurado.");
        }

        const ryzeResponse = await fetch(
            `${RYZE_URL()}/instance/list?instanceName=${encodeURIComponent(instanceName)}`,
            {
                headers: { 'token': ADMIN_TOKEN }
            }
        );

        if (!ryzeResponse.ok) {
            const errText = await ryzeResponse.text();
            throw new Error(`RyzeAPI error [${ryzeResponse.status}]: ${errText}`);
        }

        const ryzeData = await ryzeResponse.json();

        if (!ryzeData.instances || ryzeData.instances.length === 0) {
            return new Response(JSON.stringify({
                success: true,
                state: 'not_found'
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            });
        }

        const instance = ryzeData.instances[0];

        return new Response(JSON.stringify({
            success: true,
            state: instance.connection?.state || instance.status || 'disconnected',
            displayStatus: instance.connection?.displayStatus || '',
            numberJid: instance.connection?.numberJid || '',
            profile: instance.profile || null,
            instance: instance.name,
            token: instance.token
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
