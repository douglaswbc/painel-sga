import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const RYZE_URL = () => Deno.env.get('RYZE_API_URL') || 'https://ryzeapi.cloud/api'

serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    try {
        const { cobrancaId } = await req.json();
        if (!cobrancaId) throw new Error("ID da cobrança não fornecido.");

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { data: cobranca, error: queryError } = await supabaseAdmin.from('cobrancas').select(`
        *,
        contratos (
          locatarios ( nome_completo, whatsapp, email, documento, cpf ),
          usuarios ( id, ryze_instance )
        )
      `).eq('id', cobrancaId).single();

        if (queryError || !cobranca) throw new Error("Cobrança não encontrada.");

        const locatario = cobranca.contratos.locatarios;
        const usuario = cobranca.contratos.usuarios;

        const { data: mpToken } = await supabaseAdmin.rpc('get_user_mp_token', { p_user_id: usuario.id });
        const userMercadoPagoToken = mpToken || '';

        const { data: ryzeToken } = await supabaseAdmin.rpc('get_user_ryze_token', { p_user_id: usuario.id });
        usuario.ryze_token = ryzeToken || '';

        let linkDePagamento = cobranca.payment_link;
        let mercadoPagoPaymentId = cobranca.mercado_pago_id;

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
                    linkDePagamento = null;
                }
            }
        }

        if (!linkDePagamento) {
            const NOTIFICATION_URL = Deno.env.get('MP_WEBHOOK_URL');
            const [firstName, ...lastNameParts] = locatario.nome_completo.split(' ');
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
                            type: tipoDoc,
                            number: docLimpo
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

        const ordemParaFetch = Math.max(1, cobranca.tentativas_envio || 1);
        const { data: template } = await supabaseAdmin
            .from('mensagens_template')
            .select('media_url, media_type, media_mimetype, media_filename')
            .eq('id_usuario', usuario.id)
            .eq('tipo', 'cobranca')
            .eq('ordem', ordemParaFetch)
            .maybeSingle();

        const dataVencimento = new Date(cobranca.data_vencimento).toLocaleDateString('pt-BR');
        const mensagem = `Olá, ${locatario.nome_completo.split(' ')[0]}! 🚗\n\nLembramos que sua cobrança de R$ ${Number(cobranca.valor).toFixed(2).replace('.', ',')} (Vencimento: ${dataVencimento}) está disponível.\n\nLink para pagamento PIX:\n${linkDePagamento}`;

        const isMedia = !!template?.media_url;
        const endpoint = isMedia ? 'media' : 'text';
        const payload = isMedia ? {
            number: locatario.whatsapp,
            mediaType: template.media_type,
            mediaUrl: template.media_url,
            message: mensagem,
            fileName: template.media_filename,
            delay: 3
        } : {
            number: locatario.whatsapp,
            message: mensagem,
            delay: 3,
            linkPreview: /https?:\/\/\S+/i.test(mensagem)
        };

        const ryzeResponse = await fetch(`${RYZE_URL()}/message/${endpoint}/${usuario.ryze_instance}`, {
            method: 'POST',
            headers: { 'token': usuario.ryze_token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!ryzeResponse.ok) {
            const errText = await ryzeResponse.text();
            throw new Error(`Falha no envio RyzeAPI: ${errText}`);
        }

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
