import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const calculateScore = (fields) => {
    let score = 0;
    if (fields['idade_faixa']?.includes('33 a 45')) score += 30;
    if (fields['idade_faixa']?.includes('26 a 32')) score += 20;
    if (fields['trabalha_app']) score += 25;
    if (fields['caucao_disponivel']?.includes('R$ 2.000')) score += 30;
    if (fields['caucao_disponivel']?.includes('R$ 1.500')) score += 15;
    return score;
};

// ==========================================================
// FUNÇÃO CORRIGIDA
// ==========================================================
const sendWhatsAppMessage = async (supabaseAdmin, to, message) => {
    const { data: adminProfile, error } = await supabaseAdmin
        .from('usuarios')
        .select('evolution_url, evolution_instance, evolution_apikey')
        .eq('role', 'super_admin')
        .single();

    if (error || !adminProfile) {
        throw new Error('Credenciais da Evolution API não encontradas para o super_admin.');
    }
    const { evolution_url, evolution_instance, evolution_apikey } = adminProfile;

    // AJUSTE: Simplificamos o corpo da requisição para corresponder ao que a API espera.
    const body = {
        number: to,
        text: message // A mensagem agora está no campo "text" no nível principal
    };

    const response = await fetch(`${evolution_url}/message/sendText/${evolution_instance}`, {
        method: 'POST',
        headers: { 'apikey': evolution_apikey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Erro ao enviar WhatsApp:", errorBody);
        throw new Error(`Falha ao enviar mensagem via WhatsApp: ${errorBody}`);
    }
};
// ==========================================================

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const {
            nome, cpf: rawCpf, telefone: rawTelefone, idade_faixa,
            trabalha_app, tem_220v, caucao_disponivel
        } = await req.json();

        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );

        const cpf = rawCpf.replace(/\D/g, '');
        const telefone = rawTelefone.replace(/\D/g, '');
        const trabalhaApp = trabalha_app === 'Sim';
        const tem220v = tem_220v === 'Sim';

        // 1. Validação Inicial
        if (!tem220v) {
            await sendWhatsAppMessage(supabaseAdmin, telefone, `Olá, ${nome}.\nInfelizmente, seu cadastro não foi aprovado porque é necessário possuir energia 220v em casa para carregar o veículo.\nAgradecemos seu interesse!`);
            return new Response(JSON.stringify({ status: 'Reprovado por 220v' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // API Judit temporariamente desativada para testes
        const possuiProcessos = false;

        // 3. Pré-aprovação
        const scoreFormulario = calculateScore({ idade_faixa, trabalha_app: trabalhaApp, caucao_disponivel });

        const { data: adminUser, error: adminError } = await supabaseAdmin.from('usuarios').select('id').eq('role', 'super_admin').single();
        if (adminError) throw new Error("Usuário super_admin não encontrado.");

        const candidatoData = {
            id_usuario: adminUser.id, nome, cpf, telefone, idade_faixa, tem_220v: tem220v,
            trabalha_em_app: trabalhaApp, caucao_disponivel, score_formulario: scoreFormulario,
            possui_processos_criminais: possuiProcessos, status: 'Pré-aprovado'
        };

        const { error: insertError } = await supabaseAdmin.from('candidatos').insert(candidatoData);
        if (insertError) {
            if (insertError.message.includes('duplicate key value violates unique constraint')) {
                throw new Error(`O CPF ${cpf} já está cadastrado no sistema.`);
            }
            throw insertError;
        }

        await sendWhatsAppMessage(supabaseAdmin, telefone, `Olá, ${nome}! Seu cadastro foi pré-aprovado para alugar um BYD Dolphin Mini.\nA partir de agora, vou te mandar as informações necessárias pra continuar, ok?`);

        return new Response(JSON.stringify({ status: 'Pré-aprovado com sucesso' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});

