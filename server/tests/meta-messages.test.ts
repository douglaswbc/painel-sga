import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateComponents, whatsappNumberVariants } from '../services/meta-messages.js';

test('substitui cada variavel pelo valor correspondente', () => {
  const components = [{
    type: 'BODY',
    text: 'Ola {{1}}, seu boleto no valor de {{2}} com vencimento em {{3}} e o link {{4}}.',
  }];
  const params = ['Ana', 'R$ 250,00', '26/10/2026', 'https://exemplo/pagamento'];
  const built = buildTemplateComponents(components, params);

  assert.equal(built.length, 1);
  assert.equal(built[0].type, 'body');
  assert.deepEqual(
    (built[0].parameters as Array<{ text: string }>).map((parameter) => parameter.text),
    params,
  );
});

test('mantem a ordem cabecalho, corpo e botao', () => {
  // A numeracao {{n}} e global no template: cabecalho, depois corpo, depois botoes.
  const components = [
    { type: 'HEADER', format: 'TEXT', text: 'Cabecalho {{1}}' },
    { type: 'BODY', text: 'Corpo {{2}} e {{3}}' },
    { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'https://exemplo/{{4}}' }] },
  ];
  const built = buildTemplateComponents(components, ['cabecalho', 'corpo1', 'corpo2', 'botao']);

  assert.deepEqual(
    built.map((item: Record<string, any>) => item.type),
    ['header', 'body', 'button'],
  );
  assert.equal((built[0].parameters as Array<{ text: string }>)[0].text, 'cabecalho');
  assert.equal((built[1].parameters as Array<{ text: string }>)[0].text, 'corpo1');
  assert.equal((built[1].parameters as Array<{ text: string }>)[1].text, 'corpo2');
  assert.equal((built[2].parameters as Array<{ text: string }>)[0].text, 'botao');
  assert.equal(built[2].index, 0);
  assert.equal(built[2].sub_type, 'url');
});

test('template sem variaveis nao gera componentes', () => {
  assert.deepEqual(buildTemplateComponents([{ type: 'BODY', text: 'Mensagem fixa' }], []), []);
});

test('numero brasileiro com e sem o nono digito', () => {
  assert.deepEqual(whatsappNumberVariants('+55 11 92217-5013'), ['5511922175013', '551122175013']);
  assert.deepEqual(whatsappNumberVariants('551122175013'), ['551122175013', '5511922175013']);
  assert.deepEqual(whatsappNumberVariants('11999999999'), ['11999999999']);
});
