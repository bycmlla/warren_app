# Validação da Etapa 4 — 11/10/2026

O fluxo está pronto para validação manual com o pagamento indisponível. O frontend está rodando na porta 8081 e foi reaberto na tela inicial do Android Emulator, mantendo a sessão existente. O backend continua na porta 3000.

1. **O que já estava implementado pelo Claude**

   Autenticação e perfis USER/ADMIN, aceite dos Termos de Uso por versão e hash, oferta com condições do curso, checkout com aviso de indisponibilidade, regras para cursos gratuitos/pagos/restritos, progresso sequencial, concessão administrativa e validação comercial no cadastro e na publicação. A oferta já usava a capa exclusivamente no fundo desfocado, com o véu `rgba(250, 245, 236, 0.72)`. Essas implementações foram preservadas.

2. **O que faltava confirmar ou corrigir**

   Os cenários pendentes precisavam de resultados efetivos no emulador e na API. A oferta priorizava o subtítulo mesmo quando havia uma descrição cadastrada. O arquivo gerado de tipos do Expo Router estava desatualizado: faltava a rota inicial e apareciam caminhos de componentes como rotas, causando 12 erros no typecheck. Também faltava cobertura automatizada específica para outro curso pago, conclusão de curso gratuito e transmissão de um arquivo protegido com autorização e revogação.

3. **Alterações realizadas**

   Em `frontend/src/app/offer/[id].tsx`, a descrição passa a ter prioridade; o subtítulo é usado quando não há descrição. A estética, o desfoque, o véu e a posição da imagem continuam iguais.

   Em `backend/integracao/comercial.js`, foram acrescentados três cenários de regressão: reutilização do aceite em outro curso com condições diferentes; progresso gratuito até 100% sem compra; e proteção de aula/arquivo/progresso antes da concessão e após a revogação, incluindo URL direta e leitura parcial HTTP Range.

   Os tipos gerados do Expo Router foram regenerados e o Metro foi reiniciado para manter o contexto correto de `src/app`. Foi mantido o redirecionamento de portas do ADB para 8081 e 3000. Não houve alteração de dependências nem criação de projetos nativos.

4. **Testes executados e resultados**

   | Cenário | Evidência e resultado |
   | --- | --- |
   | Outro curso pago, ID 42 | No Android, uma conta USER com aceite vigente abriu a oferta sem repetir os termos. Foram conferidos nome, instrutora Teste, preço de R$ 297,00, descrição cadastrada, Pix sem desconto e acesso sem vencimento. O teste de integração usa outro curso com preço e prazo diferentes para conferir que as condições pertencem ao curso solicitado. |
   | Curso pago, ID 40 | Oferta conferida no Android: instrutora Joanalia, preço R$ 297,00, Pix R$ 282,15, condições de cartão e prazo de 12 meses. Capa somente no fundo desfocado, sem duplicação no card. |
   | Curso gratuito, ID 41 | No Android, abriu a primeira aula sem checkout. O botão de Spotify e a ação de concluir estavam disponíveis. A gravação e a progressão de 33%, 67% e 100% foram verificadas no banco isolado; nenhuma aula da conta original foi marcada como concluída. Nenhum pedido ou matrícula de compra foi criado no cenário gratuito. |
   | Curso restrito, ID 43 | No Android, permaneceu bloqueado sem oferta de compra. Na integração isolada, a autorização administrativa permitiu abrir a aula, e a revogação voltou a bloquear, preservando o progresso. |
   | Aulas e mídias protegidas | A rota direta da aula 80 mostrou bloqueio no Android. Na API ativa, aula, mídia e progresso sem autorização retornaram 403. Na integração, acesso sem autenticação retornou 401; caminhos brutos de arquivo retornaram 404; o catálogo não expôs a URL do arquivo. Um arquivo WAV de teste só retornou 200/206 após concessão administrativa e voltou a retornar 403 após revogação. |
   | Spotify | O curso gratuito manteve o botão e o endereço público externo. A API não entregou o link da aula protegida ao aluno sem acesso. O teste não afirma que o aplicativo pode tornar privado um endereço público do Spotify. |
   | Comprar agora | Nos cursos 40 e 42, abriu o checkout correto. As condições cadastradas foram exibidas junto do aviso de indisponibilidade; o botão de confirmar permaneceu desabilitado. Nenhum meio de pagamento está operacional sem provedor. Uma tentativa direta na API retornou 503 `PAGAMENTO_INDISPONIVEL`, sem criar pedido. |
   | Publicação paga na interface | Cinco cenários passaram na versão web compilada do mesmo formulário, em sessão ADMIN e banco temporários: login e abertura; preço vazio com mensagem e borda vermelhas; zero/negativo/texto inválido; rascunho sem preço; publicação com preço positivo, Pix e conteúdo completo. A cor do erro foi conferida como `rgb(154, 75, 60)`. O formulário começou como restrito e só mudou para pago após seleção explícita. |
   | Publicação por requisição direta | A integração recusou preços inválidos com 400 e publicação incompleta com 422. Com preço e pagamento habilitado, publicou. A edição não conseguiu remover o preço de um curso pago publicado. |

   As verificações finais encerraram com código 0:

   - `backend`: `npm test` — **49/49**, nenhuma falha ou teste ignorado.
   - `backend`: suíte `integracao/comercial.js` — **30/30**, incluindo o teste principal e os 29 cenários, em banco isolado.
   - Formulário web: harness temporário com Playwright/Edge — **6/6**, incluindo o teste principal e os cinco cenários; nenhum erro de execução JavaScript.
   - `frontend`: `npm run typecheck` e `npm run lint` — **aprovados**.
   - `frontend`: `expo export --platform all` — **aprovado para Android, iOS e web**, com 31 rotas estáticas web. Os bundles nativos Hermes foram gerados; isso não é um APK/IPA assinado.

5. **Problemas corrigidos e preservação**

   Corrigidos a prioridade da descrição na oferta e o cache de tipos das rotas. Os ajustes de seletores feitos durante a automação web foram apenas no harness temporário; não exigiram mudanças no formulário.

   A comparação com as cópias iniciais confirmou: dos 27 arquivos em `backend/src`, nenhum mudou; dos 73 arquivos em `frontend/src`, somente a oferta mudou; e a única alteração da suíte de integração foi em `comercial.js`. Os diffs originais do Git, tanto staged quanto unstaged, permaneceram iguais. Não houve commit, reset, descarte de arquivos, desinstalação, limpeza de dados ou redefinição do emulador.

   Os testes que gravam dados usaram bancos temporários com apenas o esquema, sem copiar contas ou credenciais existentes. As 14 tabelas do banco original mantiveram as mesmas contagens e hashes de conteúdo antes e depois. Os bancos temporários foram removidos ao finalizar. A sessão e o único aceite existente foram preservados, sem pedidos, acessos ou progresso novos nos dados originais.

6. **Dependências da integração de pagamento e limites**

   Falta implementar e configurar um adaptador real de pagamento: métodos disponíveis na conta, condições reais de parcelamento, checkout seguro, criação e consulta de cobrança e validação da assinatura das notificações. Depois disso será necessário validar o ciclo real de pagamento e liberação.

   Nenhuma compra foi aprovada nem simulada na API ativa ou no aplicativo. A suíte de integração já existente usa seu provedor falso exclusivamente no processo e no banco isolados para verificar regras de confirmação, idempotência, vencimento e reembolso; isso não comprova uma cobrança real.

   Não foram realizados teste em iPhone físico/simulador, build nativo assinado, pagamento real ou concessão administrativa na conta original. A conclusão de aulas e a concessão/revogação foram comprovadas pela API isolada, não por cliques na sessão Android existente. A mensagem vermelha foi comprovada na versão web do formulário, não em uma sessão ADMIN no Android.

7. **Disponibilidade para validação manual**

   Pode testar agora no emulador. A tela inicial está aberta, com o frontend em 8081 e o backend em 3000. Confira os cursos pagos 40/42, o gratuito 41 e o restrito 43. O resultado esperado de Comprar agora continua sendo um checkout com pagamento indisponível e confirmação desabilitada.

   Para iniciar novamente pelo PowerShell, na raiz do projeto:

   ```powershell
   cd frontend
   npm run android
   ```

   O servidor já está rodando nesta sessão; esse comando serve para uma próxima inicialização.

As capturas e os comprovantes sem credenciais estão em `validacao-etapa-4/`: [oferta 40](validacao-etapa-4/oferta-40.png), [oferta 42](validacao-etapa-4/oferta-42.png), [checkout indisponível](validacao-etapa-4/checkout-40.png), [aula bloqueada](validacao-etapa-4/aula-protegida.png), [curso gratuito](validacao-etapa-4/aula-gratuita.png), [curso restrito](validacao-etapa-4/curso-restrito.png), [erro de preço](validacao-etapa-4/erro-preco.png), [preservação do banco](validacao-etapa-4/preservacao-banco.json) e [preservação dos arquivos](validacao-etapa-4/preservacao-arquivos.json).
