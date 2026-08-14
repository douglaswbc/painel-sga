
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EVOLUTION_URL = () => Deno.env.get('EVOLUTION_API_URL') || ''
const API_KEY = () => Deno.env.get('EVOLUTION_API_KEY') || ''

serve(async (req) => {
    console.log(`[payment-webhook-receiver] >>> ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
        console.log('[payment-webhook-receiver] OPTIONS (CORS) → 200');
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const payload = await req.json();
        console.log('[payment-webhook-receiver] payload:', JSON.stringify(payload));
        console.log('[payment-webhook-receiver] headers:', JSON.stringify({
            'content-type': req.headers.get('content-type'),
            'user-agent': req.headers.get('user-agent'),
            'x-signature': req.headers.get('x-signature'),
            'x-request-id': req.headers.get('x-request-id'),
        }));

        if (payload.action === 'payment.updated' || payload.type === 'payment' || payload.topic === 'payment') {
            console.log(`[payment-webhook-receiver] notificação de pagamento detectada (action=${payload.action}, type=${payload.type}, topic=${payload.topic})`);

            const resourceId = typeof payload.resource === 'string'
                ? payload.resource.split('/').filter(Boolean).pop()
                : (payload.resource ?? '');
            const queryId = new URL(req.url).searchParams.get('id') ?? '';
            const paymentId = payload.data?.id || resourceId || queryId;
            if (!paymentId) {
                console.log('[payment-webhook-receiver] ERRO: não foi possível extrair o paymentId do payload → 400');
                return new Response(JSON.stringify({ error: 'paymentId não encontrado no payload' }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 400
                });
            }
            console.log(`[payment-webhook-receiver] paymentId extraído: ${paymentId}`);

            const supabaseAdmin = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            );

            let { data: cobranca } = await supabaseAdmin
                .from('cobrancas')
                .select('*, contratos(usuarios(*), locatarios(*))')
                .eq('mercado_pago_id', paymentId.toString())
                .single();

            console.log(`[payment-webhook-receiver] cobrança localizada? ${cobranca ? `SIM (id=${cobranca.id}, status=${cobranca.status}, valor=${cobranca.valor})` : 'NÃO'}`);

            let { data: candidato } = !cobranca ? await supabaseAdmin
                .from('candidatos')
                .select('*, usuarios(*)')
                .eq('pagamento_id', paymentId.toString())
                .single() : { data: null };

            console.log(`[payment-webhook-receiver] candidato localizado? ${candidato ? `SIM (id=${candidato.id}, status=${candidato.status})` : 'NÃO'}`);

            if (!cobranca && !candidato) {
                console.log(`[payment-webhook-receiver] pagamento ${paymentId} NÃO localizado no sistema → 404`);
                return new Response(JSON.stringify({ error: `Pagamento ${paymentId} não localizado no sistema` }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 404
                });
            }

            const locador = cobranca ? cobranca.contratos.usuarios : candidato.usuarios;
            console.log(`[payment-webhook-receiver] locador: nome=${locador?.nome_completo || locador?.empresa_nome || '?'} (id=${locador?.id}, ryze_instance=${locador?.ryze_instance || ''})`);

            const { data: mpToken } = await supabaseAdmin.rpc('get_user_mp_token', { p_user_id: locador.id });
            const accessToken = mpToken || locador.access_token_mercado_pago || '';

            if (!accessToken) {
                console.log('[payment-webhook-receiver] ERRO: locador sem Access Token configurado');
                throw new Error("Locador sem Access Token configurado.");
            }
            console.log(`[payment-webhook-receiver] token MP obtido (tamanho=${accessToken.length})`);

            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const mpPayment = await mpResponse.json();

            if (!mpResponse.ok) {
                console.log(`[payment-webhook-receiver] ERRO ao consultar MP (HTTP ${mpResponse.status}): ${JSON.stringify(mpPayment)}`);
                throw new Error(`Mercado Pago retornou HTTP ${mpResponse.status} ao consultar o pagamento`);
            }

            console.log(`[payment-webhook-receiver] consulta MP payment ${paymentId}: payment.status=${mpPayment.status}`);

            if (mpPayment.status === 'approved') {
                console.log('[payment-webhook-receiver] pagamento APROVADO → atualizando registros');

                if (cobranca && cobranca.status !== 'pago') {
                    await supabaseAdmin.from('cobrancas').update({
                        status: 'pago',
                        data_pagamento: new Date().toISOString()
                    }).eq('id', cobranca.id);
                    console.log(`[payment-webhook-receiver] cobrança ${cobranca.id} marcada como PAGO`);

                    await sendWhatsApp(supabaseAdmin, locador, cobranca.contratos.locatarios.whatsapp,
                        `✅ Pagamento Confirmado!\nRecebemos o valor de R$ ${cobranca.valor} referente ao seu aluguel. Obrigado!`);
                } else if (cobranca) {
                    console.log(`[payment-webhook-receiver] cobrança ${cobranca.id} já estava paga (status=${cobranca.status}), ignorando`);
                }

                if (candidato && candidato.status !== 'Vaga Reservada') {
                    await supabaseAdmin.from('candidatos').update({
                        status: 'Vaga Reservada',
                        pagamento_status: 'Confirmado',
                        reserva_confirmada_em: new Date().toISOString()
                    }).eq('id', candidato.id);
                    console.log(`[payment-webhook-receiver] candidato ${candidato.id} → Vaga Reservada`);

                    await sendWhatsApp(supabaseAdmin, locador, candidato.telefone,
                        `🚗⚡ Reserva Confirmada!\nOlá ${candidato.nome}, sua vaga está garantida. Em breve entraremos em contato.`);
                } else if (candidato) {
                    console.log(`[payment-webhook-receiver] candidato ${candidato.id} já reservado (status=${candidato.status}), ignorando`);
                }
            } else {
                console.log(`[payment-webhook-receiver] status "${mpPayment.status}" não é "approved", nada a fazer`);
            }
        } else {
            console.log(`[payment-webhook-receiver] payload ignorado (não é notificação de pagamento): action=${payload.action}, type=${payload.type}`);
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('[payment-webhook-receiver] ERRO capturado:', error.message, error.stack || '');
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        });
    }
});

async function sendWhatsApp(supabaseAdmin: any, locador: any, numero: string, texto: string) {
    const ryze_instance = locador.ryze_instance || '';
    if (!ryze_instance) {
        console.log('[payment-webhook-receiver] sendWhatsApp: locador sem ryze_instance, mensagem não enviada');
        return;
    }

    const hasLink = /https?:\/\/\S+/i.test(texto);
    try {
        const resp = await fetch(`${EVOLUTION_URL()}/message/sendText/${ryze_instance}`, {
            method: 'POST',
            headers: { 'apikey': API_KEY(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: numero, text: texto, delay: 1200, linkPreview: hasLink })
        });
        console.log(`[payment-webhook-receiver] sendWhatsApp para ${numero} (instância ${ryze_instance}): HTTP=${resp.status}`);
    } catch (err) {
        console.error(`[payment-webhook-receiver] sendWhatsApp falhou para ${numero}:`, err.message);
    }
}
