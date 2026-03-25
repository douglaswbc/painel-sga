import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { cobrancaId } = await req.json();
        if (!cobrancaId) throw new Error("ID da cobrança não fornecido.");

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        // 1. Busca dados da cobrança e do locador
        const { data: cobranca, error: queryError } = await supabaseAdmin.from('cobrancas').select(`
        *,
        contratos (
          locatarios ( nome_completo, whatsapp, email, documento, cpf ),
          usuarios ( id, access_token_mercado_pago, evolution_url, evolution_instance, evolution_apikey )
        )
      `).eq('id', cobrancaId).single();

        if (queryError || !cobranca) throw new Error("Cobrança não encontrada.");

        const locatario = cobranca.contratos.locatarios;
        const usuario = cobranca.contratos.usuarios;
        const userMercadoPagoToken = usuario.access_token_mercado_pago;

        let linkDePagamento = cobranca.payment_link;
        let mercadoPagoPaymentId = cobranca.mercado_pago_id;

        // --- LÓGICA DE VERIFICAÇÃO EXISTENTE ---
        if (mercadoPagoPaymentId && linkDePagamento) {
            const checkMP = await fetch(`https://api.mercadopago.com/v1/payments/${mercadoPagoPaymentId}`, {
                headers: { 'Authorization': `Bearer ${userMercadoPagoToken}` }
            });

            if (checkMP.ok) {
                const mpStatus = await checkMP.json();
                if (mpStatus.status === 'pending') {
                    console.log("Pagamento pendente. Reenviando existente.");
                } else if (mpStatus.status === 'approved') {
                    await supabaseAdmin.from('cobrancas').update({ status: 'pago' }).eq('id', cobrancaId);
                    return new Response(JSON.stringify({ success: true, message: "Esta cobrança já está paga." }));
                } else {
                    linkDePagamento = null; // Expirado/Cancelado, gera novo abaixo
                }
            }
        }

        // --- CRIAÇÃO DE NOVA COBRANÇA COM CPF/CNPJ DINÂMICO ---
        if (!linkDePagamento) {
            const NOTIFICATION_URL = Deno.env.get('MP_WEBHOOK_URL');
            const [firstName, ...lastNameParts] = locatario.nome_completo.split(' ');

            // Limpeza e Identificação do Documento
            const docLimpo = (locatario.cpf || "").replace(/\D/g, '');
            const tipoDoc = docLimpo.length > 11 ? "CNPJ" : "CPF";

            const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${userMercadoPagoToken}`,
                    'X-Idempotency-Key': `${cobranca.id}-${Date.now()}`
                },
                body: JSON.stringify({
                    transaction_amount: Number(cobranca.valor),
                    description: `Aluguel - ${locatario.nome_completo}`,
                    payment_method_id: "pix",
                    notification_url: NOTIFICATION_URL,
                    payer: {
                        email: locatario.email || 'financeiro@sga.com',
                        first_name: firstName,
                        last_name: lastNameParts.join(' ') || firstName,
                        identification: {
                            type: tipoDoc,     // CPF ou CNPJ baseado no tamanho
                            number: docLimpo   // Apenas números
                        }
                    }
                })
            });

            if (!mpResponse.ok) {
                const errorData = await mpResponse.json();
                throw new Error(`Mercado Pago: ${errorData.message || 'Erro ao criar PIX'}`);
            }

            const mpData = await mpResponse.json();
            linkDePagamento = mpData.point_of_interaction.transaction_data.ticket_url;
            mercadoPagoPaymentId = mpData.id.toString();

            await supabaseAdmin.from('cobrancas').update({
                mercado_pago_id: mercadoPagoPaymentId,
                payment_link: linkDePagamento
            }).eq('id', cobrancaId);
        }

        // --- ENVIO WHATSAPP ---
        const dataVencimento = new Date(cobranca.data_vencimento).toLocaleDateString('pt-BR');
        const mensagem = `Olá, ${locatario.nome_completo.split(' ')[0]}! 🚗\n\nLembramos que sua cobrança de R$ ${Number(cobranca.valor).toFixed(2).replace('.', ',')} (Vencimento: ${dataVencimento}) está disponível.\n\nLink para pagamento PIX:\n${linkDePagamento}`;

        await fetch(`${usuario.evolution_url}/message/sendText/${usuario.evolution_instance}`, {
            method: 'POST',
            headers: { 'apikey': usuario.evolution_apikey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: locatario.whatsapp, text: mensagem })
        });

        return new Response(JSON.stringify({ success: true, message: "Cobrança enviada com sucesso!" }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400
        });
    }
});
