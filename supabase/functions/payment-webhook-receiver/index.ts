
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EVOLUTION_URL = () => Deno.env.get('EVOLUTION_API_URL') || ''
const API_KEY = () => Deno.env.get('EVOLUTION_API_KEY') || ''

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const payload = await req.json();

        if (payload.action === 'payment.updated' || payload.type === 'payment') {
            const paymentId = payload.data?.id || payload.resource?.split('/').pop();

            const supabaseAdmin = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            );

            let { data: cobranca } = await supabaseAdmin
                .from('cobrancas')
                .select('*, contratos(usuarios(*), locatarios(*))')
                .eq('mercado_pago_id', paymentId.toString())
                .single();

            let { data: candidato } = !cobranca ? await supabaseAdmin
                .from('candidatos')
                .select('*, usuarios(*)')
                .eq('pagamento_id', paymentId.toString())
                .single() : { data: null };

            if (!cobranca && !candidato) {
                return new Response('Pagamento não localizado no sistema', { status: 404 });
            }

            const locador = cobranca ? cobranca.contratos.usuarios : candidato.usuarios;
            const accessTokenData = await supabaseAdmin.rpc('get_user_mp_token', { p_user_id: locador.id });
            const accessToken = (accessTokenData) || locador.access_token_mercado_pago || '';

            if (!accessToken) throw new Error("Locador sem Access Token configurado.");

            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const mpPayment = await mpResponse.json();

            if (mpPayment.status === 'approved') {

                if (cobranca && cobranca.status !== 'pago') {
                    await supabaseAdmin.from('cobrancas').update({
                        status: 'pago',
                        data_pagamento: new Date().toISOString()
                    }).eq('id', cobranca.id);

                    await sendWhatsApp(supabaseAdmin, locador, cobranca.contratos.locatarios.whatsapp,
                        `✅ Pagamento Confirmado!\nRecebemos o valor de R$ ${cobranca.valor} referente ao seu aluguel. Obrigado!`);
                }

                if (candidato && candidato.status !== 'Vaga Reservada') {
                    await supabaseAdmin.from('candidatos').update({
                        status: 'Vaga Reservada',
                        pagamento_status: 'Confirmado',
                        reserva_confirmada_em: new Date().toISOString()
                    }).eq('id', candidato.id);

                    await sendWhatsApp(supabaseAdmin, locador, candidato.telefone,
                        `🚗⚡ Reserva Confirmada!\nOlá ${candidato.nome}, sua vaga está garantida. Em breve entraremos em contato.`);
                }
            }
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }
});

async function sendWhatsApp(supabaseAdmin: any, locador: any, numero: string, texto: string) {
    const ryze_instance = locador.ryze_instance || '';
    if (!ryze_instance) return;

    const hasLink = /https?:\/\/\S+/i.test(texto);
    await fetch(`${EVOLUTION_URL()}/message/sendText/${ryze_instance}`, {
        method: 'POST',
        headers: { 'apikey': API_KEY(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: numero, text: texto, delay: 1200, linkPreview: hasLink })
    });
}
