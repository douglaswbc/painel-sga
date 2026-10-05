# Sistema visual do Painel SGA

O projeto adota uma linguagem inspirada no Apple Design System descrito em [getdesign.md](https://getdesign.md/design-md/apple/DESIGN.md), adaptada para um sistema administrativo de locação. A prioridade é leitura rápida, hierarquia simples e superfícies discretas; densidade de tabelas e formulários deve continuar adequada ao trabalho operacional.

## Fundamentos

- **Azul de ação único:** `#0066cc`; foco acessível em `#0071e3`.
- **Superfícies:** branco `#ffffff`, parchment `#f5f5f7`, pearl `#fafafc` e blocos escuros `#272729`–`#2a2a2c` quando houver razão de conteúdo.
- **Texto:** ink `#1d1d1f`, secundário `#333333`, auxiliar `#7a7a7a`; texto em superfícies escuras usa branco ou `#cccccc`.
- **Tipografia:** SF Pro quando disponível; fallback `system-ui`, `-apple-system`, `BlinkMacSystemFont` e sans-serif. Títulos usam peso 600; texto corrido, 400.
- **Bordas e profundidade:** hairline `#e0e0e0`; cartões não usam sombras. Sombra é reservada a imagens que precisem parecer apoiadas numa superfície.
- **Raios:** 18px para cartões, 8px para controles utilitários e pílula para ações principais e chips.
- **Ritmo:** base 8px, com passos de 12, 17, 24, 32 e 48px. Em telas estreitas, uma coluna e alvos de toque de pelo menos 44px.

## Componentes

- Ação primária: pílula azul, texto branco, foco de 2px e estado pressionado em escala `0.95`.
- Ação secundária: pílula transparente com borda e texto azul.
- Cartões operacionais: fundo branco, raio de 18px e borda fina; sem sombra.
- Campos de formulário: fundo branco, raio de 8px, borda hairline e foco azul visível.
- Navegação autenticada: trilho preto com links discretos e seleção azul; conteúdo principal em fundo parchment.
- Mensagens de sucesso, alerta e erro mantêm cores semânticas para que o estado seja reconhecível sem depender apenas do azul de marca.
- Prévia de canal externo, como o WhatsApp, conserva as cores do produto representado.

## Implementação

Tokens globais estão em `src/index.css`. O shell autenticado carrega o tema pelo escopo `.sga-app`; componentes reutilizáveis ficam em `src/components/ui`. As telas devem preferir esses componentes e os tokens acima em vez de introduzir novas cores, sombras ou raios sem função clara.

