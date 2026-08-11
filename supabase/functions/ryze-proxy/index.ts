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
        const { action, instanceName, payload } = await req.json();

        if (!action || !instanceName) {
            throw new Error("Parâmetros 'action' e 'instanceName' são obrigatórios.");
        }

        const API_KEY = Deno.env.get('EVOLUTION_API_KEY');
        if (!API_KEY) throw new Error("EVOLUTION_API_KEY não configurado.");

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) throw new Error("Token de autenticação não encontrado.");

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? ''
        );

        const { data: { user }, error: authError } = await supabase.auth.getUser(
            authHeader.replace('Bearer ', '')
        );

        if (authError || !user) throw new Error("Usuário não autenticado.");

        let evolutionResponse;

        switch (action) {
            case 'connect': {
                evolutionResponse = await fetch(`${EVOLUTION_URL()}/instance/connect/${instanceName}`, {
                    headers: { 'apikey': API_KEY }
                });
                break;
            }
            case 'reconnect': {
                evolutionResponse = await fetch(`${EVOLUTION_URL()}/instance/restart/${instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': API_KEY }
                });
                break;
            }
            case 'logout': {
                evolutionResponse = await fetch(`${EVOLUTION_URL()}/instance/logout/${instanceName}`, {
                    method: 'DELETE',
                    headers: { 'apikey': API_KEY }
                });
                break;
            }
            case 'sendText': {
                if (!payload?.number || !payload?.message) {
                    throw new Error("Parâmetros 'number' e 'message' são obrigatórios para sendText.");
                }
                const hasLink = /https?:\/\/\S+/i.test(payload.message);
                evolutionResponse = await fetch(`${EVOLUTION_URL()}/message/sendText/${instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        number: payload.number,
                        text: payload.message,
                        delay: payload.delay ?? 1200,
                        linkPreview: payload.linkPreview ?? hasLink
                    })
                });
                break;
            }
            case 'sendMedia': {
                if (!payload?.number || !payload?.mediaType || !payload?.mediaUrl) {
                    throw new Error("Parâmetros 'number', 'mediaType' e 'mediaUrl' são obrigatórios para sendMedia.");
                }
                evolutionResponse = await fetch(`${EVOLUTION_URL()}/message/sendMedia/${instanceName}`, {
                    method: 'POST',
                    headers: { 'apikey': API_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        number: payload.number,
                        mediatype: payload.mediaType,
                        mimetype: payload.mimeType || 'image/jpeg',
                        caption: payload.message || '',
                        media: payload.mediaUrl,
                        fileName: payload.fileName || '',
                        delay: payload.delay ?? 1200
                    })
                });
                break;
            }
            default:
                throw new Error(`Ação desconhecida: ${action}`);
        }

        const contentType = evolutionResponse.headers.get('content-type') || '';
        let data;

        if (contentType.includes('application/json')) {
            data = await evolutionResponse.json();
        } else {
            data = await evolutionResponse.text();
        }

        return new Response(JSON.stringify({
            success: evolutionResponse.ok,
            status: evolutionResponse.status,
            data
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: evolutionResponse.ok ? 200 : 400
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
