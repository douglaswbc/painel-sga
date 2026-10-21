import { assertEquals } from 'jsr:@std/assert@1';
import { buildTemplateComponents, whatsappNumberVariants } from '../functions/_shared/meta-messages.ts';

Deno.test('substitui cada variavel pelo valor correspondente', () => {
  const components = [{
    type: 'BODY',
    text: 'Ola {{1}}, seu boleto no valor de {{2}} com vencimento em {{3}} e o link {{4}}.',
  }];
  const params = ['Ana', 'R$ 250,00', '26/10/2026', 'https://exemplo/pagamento'];
  const built = buildTemplateComponents(components, params);

  assertEquals(built.length, 1);
  assertEquals(built[0].type, 'body');
  assertEquals(
    built[0].parameters.map((parameter: { text: string }) => parameter.text),
    params,
  );
});

Deno.test('mantem a ordem cabecalho, corpo e botao', () => {
  // A numeracao {{n}} e global no template: cabecalho, depois corpo, depois botoes.
  const components = [
    { type: 'HEADER', format: 'TEXT', text: 'Cabecalho {{1}}' },
    { type: 'BODY', text: 'Corpo {{2}} e {{3}}' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'https://exemplo/{{4}}' }] },
  ];
  const built = buildTemplateComponents(components, ['cabecalho', 'corpo1', 'corpo2', 'botao']);

  assertEquals(built.map((item: Record<string, any>) => item.type), ['header', 'body', 'button']);
  assertEquals(built[0].parameters[0].text, 'cabecalho');
  assertEquals(built[1].parameters[0].text, 'corpo1');
  assertEquals(built[1].parameters[1].text, 'corpo2');
  assertEquals(built[2].parameters[0].text, 'botao');
  assertEquals(built[2].index, 0);
  assertEquals(built[2].sub_type, 'url');
});

Deno.test('template sem variaveis nao gera componentes', () => {
  assertEquals(buildTemplateComponents([{ type: 'BODY', text: 'Mensagem fixa' }], []), []);
});

Deno.test('numero brasileiro com e sem o nono digito', () => {
  assertEquals(whatsappNumberVariants('+55 11 92217-5013'), ['5511922175013', '551122175013']);
  assertEquals(whatsappNumberVariants('551122175013'), ['551122175013', '5511922175013']);
  assertEquals(whatsappNumberVariants('11999999999'), ['11999999999']);
});
