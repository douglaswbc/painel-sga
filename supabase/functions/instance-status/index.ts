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
        const { instanceName } = await req.json();

        if (!instanceName) {
            throw new Error("Nome da instância não fornecido.");
        }

        const API_KEY = Deno.env.get('EVOLUTION_API_KEY');
        if (!API_KEY) {
            throw new Error("EVOLUTION_API_KEY não configurado.");
        }

        const evolutionResponse = await fetch(
            `${EVOLUTION_URL()}/instance/connectionState/${encodeURIComponent(instanceName)}`,
            {
                headers: { 'apikey': API_KEY }
            }
        );

        if (!evolutionResponse.ok) {
            const errText = await evolutionResponse.text();
            throw new Error(`Evolution API error [${evolutionResponse.status}]: ${errText}`);
        }

        const evolutionData = await evolutionResponse.json();

        if (!evolutionData || evolutionData.error) {
            return new Response(JSON.stringify({
                success: true,
                state: 'not_found'
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            });
        }

        const rawState = evolutionData.state || evolutionData.instance?.state || 'close';
        const state = rawState === 'open' ? 'connected' : rawState === 'close' ? 'disconnected' : rawState;

        return new Response(JSON.stringify({
            success: true,
            state,
            displayStatus: evolutionData.state || '',
            numberJid: evolutionData.numberJid || '',
            profile: null,
            instance: evolutionData.name || instanceName
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
