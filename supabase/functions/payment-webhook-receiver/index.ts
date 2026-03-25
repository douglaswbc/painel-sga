
//Recommended: OFF with JWT and custom auth logic in your function code.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const payload = await req.json();

        // O Mercado Pago envia notificações de vários tipos, filtramos apenas pagamentos
        if (payload.action === 'payment.updated' || payload.type === 'payment') {
            const paymentId = payload.data?.id || payload.resource?.split('/').pop();

            const supabaseAdmin = createClient(
                Deno.env.get('SUPABASE_URL') ?? '',
                Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
            );

            // --- PASSO 1: LOCALIZAR O DONO DO PAGAMENTO ---
            // Procuramos primeiro em Cobranças (Aluguéis)
            let { data: cobranca } = await supabaseAdmin
                .from('cobrancas')
                .select('*, contratos(usuarios(*), locatarios(*))')
                .eq('mercado_pago_id', paymentId.toString())
                .single();

            // Se não achou em cobranças, procuramos em Candidatos (Reservas)
            let { data: candidato } = !cobranca ? await supabaseAdmin
                .from('candidatos')
                .select('*, usuarios(*)')
                .eq('pagamento_id', paymentId.toString())
                .single() : { data: null };

            if (!cobranca && !candidato) {
                return new Response('Pagamento não localizado no sistema', { status: 404 });
            }

            // Identificamos o Locador (Dono) e suas credenciais
            const locador = cobranca ? cobranca.contratos.usuarios : candidato.usuarios;
            const accessToken = locador.access_token_mercado_pago;

            if (!accessToken) throw new Error("Locador sem Access Token configurado.");

            // --- PASSO 2: VALIDAR STATUS NO MERCADO PAGO ---
            const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const mpPayment = await mpResponse.json();

            if (mpPayment.status === 'approved') {

                // --- CENÁRIO A: É UMA COBRANÇA DE ALUGUEL ---
                if (cobranca && cobranca.status !== 'pago') {
                    await supabaseAdmin.from('cobrancas').update({
                        status: 'pago',
                        data_pagamento: new Date().toISOString()
                    }).eq('id', cobranca.id);

                    await sendWhatsApp(locador, cobranca.contratos.locatarios.whatsapp,
                        `✅ Pagamento Confirmado!\nRecebemos o valor de R$ ${cobranca.valor} referente ao seu aluguel. Obrigado!`);
                }

                // --- CENÁRIO B: É UMA TAXA DE RESERVA (CANDIDATO) ---
                if (candidato && candidato.status !== 'Vaga Reservada') {
                    await supabaseAdmin.from('candidatos').update({
                        status: 'Vaga Reservada',
                        pagamento_status: 'Confirmado',
                        reserva_confirmada_em: new Date().toISOString()
                    }).eq('id', candidato.id);

                    await sendWhatsApp(locador, candidato.telefone,
                        `🚗⚡ Reserva Confirmada!\nOlá ${candidato.nome}, sua vaga está garantida. Em breve entraremos em contato.`);

                    // Aqui você dispararia a lógica de Score de Crédito que mencionou
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

// Função auxiliar para enviar WhatsApp usando a instância do Locador específico
async function sendWhatsApp(locador, numero, texto) {
    const { evolution_url, evolution_apikey, evolution_instance } = locador;
    if (!evolution_url || !evolution_instance) return;

    await fetch(`${evolution_url}/message/sendText/${evolution_instance}`, {
        method: 'POST',
        headers: { 'apikey': evolution_apikey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: numero, text: texto })
    });
}