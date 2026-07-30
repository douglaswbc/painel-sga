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
        const { action, instanceName, payload } = await req.json();

        if (!action || !instanceName) {
            throw new Error("Parâmetros 'action' e 'instanceName' são obrigatórios.");
        }

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

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { data: usuario, error: userError } = await supabaseAdmin
            .from('usuarios')
            .select('id, ryze_instance')
            .eq('id', user.id)
            .single();

        if (userError || !usuario?.ryze_instance) {
            throw new Error("Instância não configurada para este usuário.");
        }

        const { data: ryzeToken } = await supabaseAdmin.rpc('get_user_ryze_token', { p_user_id: user.id });
        const token = ryzeToken;

        if (!token) {
            throw new Error("Token RyzeAPI não encontrado para este usuário.");
        }
        let ryzeResponse;

        switch (action) {
            case 'connect': {
                ryzeResponse = await fetch(`${RYZE_URL()}/instance/connect/${instanceName}`, {
                    headers: { 'token': token }
                });
                break;
            }
            case 'reconnect': {
                ryzeResponse = await fetch(`${RYZE_URL()}/instance/reconnect/${instanceName}`, {
                    method: 'POST',
                    headers: { 'token': token }
                });
                break;
            }
            case 'logout': {
                ryzeResponse = await fetch(`${RYZE_URL()}/instance/logout/${instanceName}`, {
                    method: 'DELETE',
                    headers: { 'token': token }
                });
                break;
            }
            case 'sendText': {
                if (!payload?.number || !payload?.message) {
                    throw new Error("Parâmetros 'number' e 'message' são obrigatórios para sendText.");
                }
                const hasLink = /https?:\/\/\S+/i.test(payload.message);
                ryzeResponse = await fetch(`${RYZE_URL()}/message/text/${instanceName}`, {
                    method: 'POST',
                    headers: { 'token': token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        number: payload.number,
                        message: payload.message,
                        delay: payload.delay ?? 3,
                        linkPreview: payload.linkPreview ?? hasLink
                    })
                });
                break;
            }
            case 'sendMedia': {
                if (!payload?.number || !payload?.mediaType || !payload?.mediaUrl) {
                    throw new Error("Parâmetros 'number', 'mediaType' e 'mediaUrl' são obrigatórios para sendMedia.");
                }
                ryzeResponse = await fetch(`${RYZE_URL()}/message/media/${instanceName}`, {
                    method: 'POST',
                    headers: { 'token': token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        number: payload.number,
                        mediaType: payload.mediaType,
                        mediaUrl: payload.mediaUrl,
                        message: payload.message || '',
                        fileName: payload.fileName || '',
                        delay: payload.delay ?? 3
                    })
                });
                break;
            }
            default:
                throw new Error(`Ação desconhecida: ${action}`);
        }

        const contentType = ryzeResponse.headers.get('content-type') || '';
        let data;

        if (contentType.includes('application/json')) {
            data = await ryzeResponse.json();
        } else {
            data = await ryzeResponse.text();
        }

        return new Response(JSON.stringify({
            success: ryzeResponse.ok,
            status: ryzeResponse.status,
            data
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: ryzeResponse.ok ? 200 : 400
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
