import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sendWhatsAppMessage = async (supabaseAdmin, to, message) => {
    const { data: adminProfile, error } = await supabaseAdmin
        .from('usuarios')
        .select('evolution_url, evolution_instance, evolution_apikey')
        .eq('role', 'super_admin')
        .single();

    if (error || !adminProfile) {
        console.error('Credenciais da Evolution API não encontradas. A mensagem de WhatsApp não será enviada.');
        return;
    }
    const { evolution_url, evolution_instance, evolution_apikey } = adminProfile;
    const body = { number: to, text: message };

    await fetch(`${evolution_url}/message/sendText/${evolution_instance}`, {
        method: 'POST',
        headers: { 'apikey': evolution_apikey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
};

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { candidatoId } = await req.json();
        if (!candidatoId) {
            throw new Error("ID do candidato é obrigatório.");
        }

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const { data: adminProfile, error: adminError } = await supabaseAdmin
            .from('usuarios')
            .select('access_token_mercado_pago')
            .eq('role', 'super_admin')
            .single();

        if (adminError || !adminProfile?.access_token_mercado_pago) {
            throw new Error("Access Token do Mercado Pago não configurado para o super_admin.");
        }
        const MP_ACCESS_TOKEN = adminProfile.access_token_mercado_pago;

        const { data: candidato, error: candidatoError } = await supabaseAdmin
            .from('candidatos')
            .select('nome, cpf, telefone')
            .eq('id', candidatoId)
            .single();

        if (candidatoError) {
            throw new Error(`Candidato não encontrado: ${candidatoError.message}`);
        }

        const expirationDate = new Date();
        expirationDate.setHours(expirationDate.getHours() + 24);

        const paymentData = {
            transaction_amount: 25.00,
            description: `Taxa de reserva de vaga - ${candidato.nome}`,
            payment_method_id: 'pix',
            payer: {
                email: `pagador_${candidato.cpf}@email.com`,
                first_name: candidato.nome,
                identification: { type: 'CPF', number: candidato.cpf }
            },
            notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-webhook-receiver`,
            date_of_expiration: expirationDate.toISOString()
        };

        const idempotencyKey = crypto.randomUUID();

        const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify(paymentData)
        });

        const mpResult = await mpResponse.json();
        if (!mpResponse.ok) {
            console.error("Erro do Mercado Pago:", mpResult);
            throw new Error(`Erro ao criar pagamento: ${mpResult.message || JSON.stringify(mpResult)}`);
        }

        // <<-- PONTO DA CORREÇÃO 1: Extraímos o objeto com os dados da transação -->>
        const transactionData = mpResult.point_of_interaction.transaction_data;

        const updateData = {
            pagamento_id: mpResult.id.toString(),
            pagamento_status: 'Pendente',
            pix_qr_code: transactionData.qr_code_base64,
            pix_copia_e_cola: transactionData.qr_code,
            pix_url: transactionData.ticket_url, // <<-- Salvamos o link de pagamento
            reserva_expira_em: expirationDate.toISOString(),
            status: 'Aguardando Reserva'
        };

        const { error: updateError } = await supabaseAdmin.from('candidatos').update(updateData).eq('id', candidatoId);
        if (updateError) throw updateError;

        // <<-- PONTO DA CORREÇÃO 2: A mensagem agora usa o `pix_url` -->>
        const mensagemPix = `Olá, ${candidato.nome}! Sua vaga para a locação foi pré-reservada.\n\nPara garantir sua vaga, pague a taxa de R$ 25,00 em até 24 horas através do link abaixo:\n\n${updateData.pix_url}`;

        await sendWhatsAppMessage(supabaseAdmin, candidato.telefone, mensagemPix);

        return new Response(JSON.stringify({
            qrCode: updateData.pix_qr_code,
            copyPaste: updateData.pix_copia_e_cola
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});

