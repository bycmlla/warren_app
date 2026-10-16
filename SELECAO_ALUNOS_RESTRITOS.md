**Seleção de alunos para cursos restritos — implementação e validação**

Implementado em 11/10/2026. A administradora pode gerenciar a mesma autorização pelo curso e pelo aluno. As duas telas usam `matriculas` e `historico_acessos`, com a chave existente por aluno e curso. Não foi criada outra tabela de permissões nem uma migração.

No painel administrativo, abra **Adicionar curso** ou edite um curso e escolha **Restrito**. A seção **Alunos autorizados** permite pesquisar por nome ou e-mail, marcar vários alunos, consultar as autorizações existentes e ver o total selecionado e o total atualmente ativo. Cada aluno mostra sua situação e, quando já existe uma autorização, as datas de início e vencimento.

Use **Definir prazo individual** para escolher o prazo do curso, 12 meses, 24 meses ou sem vencimento. Alterar o prazo renova a autorização a partir da gravação; manter uma seleção existente preserva suas datas. As concessões e revogações nessa tela ficam preparadas até salvar o curso. Desmarcar uma autorização existente exige confirmação e mostra que a revogação será aplicada ao salvar.

O cadastro ou a atualização do curso e suas alterações de acesso são gravados na mesma transação. Uma seleção inválida desfaz a operação inteira. Um curso novo não recebe permissões antes de ser cadastrado corretamente. Rascunhos podem guardar a seleção, mas permanecem indisponíveis para alunos. Se a publicação falhar depois do cadastro, a tentativa seguinte reutiliza o curso já registrado.

Em **Vendas e acessos → Gerenciar acessos por aluno**, pesquise e selecione o aluno para consultar seus cursos pagos e restritos. Marcar um curso concede a autorização; desmarcar exige confirmação antes de revogar. **Definir prazo** permite também informar uma data de início. Essa tela aplica cada alteração diretamente e a edição do curso consulta os mesmos registros ao voltar a ficar em foco.

Cursos restritos ficam fora da Home, de Explorar conteúdos, das pesquisas e dos filtros e categorias públicas, inclusive para alunos autorizados. Um restrito aparece em **Meus cursos** somente se estiver publicado e a matrícula estiver válida: não revogada, já iniciada e ainda não vencida. O ADMIN continua acessando a administração e a pré-visualização.

O backend verifica a autorização antes de retornar os detalhes e os módulos de um curso restrito. Pedidos por ID de pessoas não autorizadas recebem `404`, sem os dados privados. A reprodução e a conclusão de aulas também são protegidas; a marcação de aula demonstrativa não libera conteúdo de cursos restritos. As rotas administrativas continuam exigindo ADMIN.

Revogar atualiza a matrícula e registra o histórico, sem excluir o usuário ou seu progresso. Uma nova concessão reaproveita a matrícula existente e o aluno pode continuar a partir das aulas já concluídas. A tela também remove os detalhes anteriormente carregados quando uma nova consulta recebe `401`, `403` ou `404`, evitando manter o conteúdo privado visível depois de uma negativa da API.

**Arquivos de aplicação alterados ou criados**

| Arquivo | Alteração |
| --- | --- |
| [frontend/src/components/access-selection.tsx](frontend/src/components/access-selection.tsx) — novo | Seleção pelo curso e pelo aluno, pesquisa, checkboxes, contagens, estados, prazos e confirmação de revogação, usando os componentes e as cores existentes. |
| [frontend/src/app/admin/course-form.tsx](frontend/src/app/admin/course-form.tsx) | Seção condicional para Restrito, seleção preparada, envio de alterações ao salvar e reaproveitamento do cadastro em uma tentativa de publicação. |
| [frontend/src/app/admin/grant-access.tsx](frontend/src/app/admin/grant-access.tsx) | Consulta e administração dos cursos autorizados do aluno selecionado. |
| [frontend/src/app/admin/sales.tsx](frontend/src/app/admin/sales.tsx) | Entrada “Gerenciar acessos por aluno” para a tela existente. |
| [frontend/src/components/admin-scaffold.tsx](frontend/src/components/admin-scaffold.tsx) | Confirmação funcional também na web; mantém o alerta nativo no Android/iOS. |
| [frontend/src/hooks/use-authorized-query.ts](frontend/src/hooks/use-authorized-query.ts) | Limpeza dos dados em memória quando a API nega o acesso ou informa remoção. |
| [frontend/src/services/admin-api.ts](frontend/src/services/admin-api.ts) | Tipos de concessão/revogação no formulário e consulta de todas as páginas de acessos com filtros exatos. |
| [backend/src/utils/acessos.js](backend/src/utils/acessos.js) | Concessão manual compartilhada, validação da seleção e aplicação das alterações com as funções e tabelas já existentes. Repetir uma concessão ativa sem alterar condições preserva prazo, origem e histórico. |
| [backend/src/controllers/adminCursoController.js](backend/src/controllers/adminCursoController.js) | Cadastro e atualização do curso com alterações de permissão na mesma transação. |
| [backend/src/controllers/adminComercialController.js](backend/src/controllers/adminComercialController.js) | Reutilização da concessão compartilhada e filtros `cursoId`/`usuarioId`, contagem e paginação em Gerenciar acessos. |
| [backend/src/controllers/catalogoController.js](backend/src/controllers/catalogoController.js) | Exclusão de restritos do catálogo público e verificação de autorização antes dos detalhes privados. |
| [backend/src/controllers/aulaController.js](backend/src/controllers/aulaController.js) | Impede que aulas demonstrativas contornem a autorização de cursos restritos. |
| [backend/src/controllers/pedidoController.js](backend/src/controllers/pedidoController.js) | Meus cursos inclui restritos somente com matrícula válida e publicação; preserva a apresentação do histórico dos cursos pagos. |

**Arquivos de testes e documentação**

| Arquivo | Alteração |
| --- | --- |
| [backend/integracao/restritos.js](backend/integracao/restritos.js) — novo | Cenários de autorização, visibilidade, revogação, progresso, transações, validade e paginação. |
| [backend/integracao/comercial.js](backend/integracao/comercial.js) | Ajuste de duas verificações para o bloqueio dos detalhes privados de restritos; os demais cenários comerciais continuam sendo executados. |
| [backend/test/autorizacao.test.js](backend/test/autorizacao.test.js) | Verificação de que a consulta do catálogo público exclui cursos restritos. |
| [backend/scripts/testar-integracao-isolada.js](backend/scripts/testar-integracao-isolada.js) — novo | Executor que cria um banco temporário com o esquema existente, executa as suítes e compara contagens e hashes do banco original antes e depois. Remove somente o banco e o armazenamento temporários criados pela execução. |
| [backend/package.json](backend/package.json) | Comandos para as duas suítes de integração e para execução isolada. |
| [backend/README.md](backend/README.md) | Regras de visibilidade, campos de seleção, filtros, transações e instruções de teste. |
| [SELECAO_ALUNOS_RESTRITOS.md](SELECAO_ALUNOS_RESTRITOS.md) — novo | Este relatório. |
| [validacao-cursos-restritos/](validacao-cursos-restritos/) — novo | Capturas das interfaces, logs das suítes web, auditoria, metadados de exportação e comprovação de preservação do banco durante os testes. |

**Validação dos dez casos solicitados**

| Caso | Resultado verificado |
| --- | --- |
| 1. ADMIN cadastra um curso restrito | Cadastro pela API e pela interface administrativa; título inválido não grava curso ou permissões. |
| 2. ADMIN seleciona dois alunos | Checkboxes preparam a seleção sem gravar matrículas; cadastro correto salva as duas autorizações. |
| 3. Os dois alunos veem o curso após a publicação | Rascunho não aparece; após publicar, ambos encontram o curso em Meus cursos. |
| 4. Outros usuários não encontram o curso | Home, catálogo, pesquisas e categorias públicas excluem restritos; usuário sem autorização não recebe os detalhes por ID. |
| 5. Autorizados iniciam e continuam as aulas | Reprodução, conclusão e avanço sequencial verificados, incluindo o fluxo da interface do aluno. |
| 6. ADMIN adiciona um terceiro aluno | Edição encontra o aluno por e-mail, concede prazo individual e libera o acesso após salvar. |
| 7. ADMIN revoga um aluno | Cancelar a confirmação preserva a seleção; confirmar prepara a revogação, efetivada ao salvar. Também validada a revogação pela tela do aluno. |
| 8. Revogado deixa de visualizar e acessar | Sai de Meus cursos; detalhes, reprodução e conclusão ficam bloqueados. Voltar de uma aula para a tela previamente carregada não mantém os detalhes após a negativa da API. |
| 9. Progresso permanece armazenado | Registros e aulas concluídas permanecem iguais após revogar; reautorizar permite continuar o curso. |
| 10. USER não concede acesso a si próprio | Requisições diretas de USER para conceder, revogar, consultar acessos ou enviar seleções nas rotas administrativas recebem `403`. |

Também passaram as verificações de acesso vencido e agendado, aulas demonstrativas restritas, rollback de criação e edição com seleção inválida, IDs duplicados ou conflitantes, concessão repetida sem duplicar matrícula ou renovar o prazo, sincronização das duas formas de gerenciamento e consulta paginada com 101 alunos autorizados.

**Resultados dos comandos e das suítes**

| Verificação | Resultado |
| --- | --- |
| `backend: npm test` | 49/49 testes passaram. |
| `backend: npm run test:integracao:isolada` | 47/47 passaram: 30 da suíte comercial e 17 da suíte de restritos. |
| Interface de cursos restritos, frontend exportado + backend real isolado | 9/9 passaram; [log](validacao-cursos-restritos/restricted-browser-final.log). |
| Interface de cursos pagos, frontend exportado + backend real isolado | 6/6 passaram; [log](validacao-cursos-restritos/paid-browser-final.log). |
| `frontend: npm run typecheck` | Concluiu sem erros. |
| `frontend: npm run lint` | Concluiu sem erros ou avisos. |
| Exportação Expo para Android, iOS e web | Bundles das três plataformas gerados, com 31 rotas web; [metadados](validacao-cursos-restritos/expo-export-metadata.json). |

As contagens são as informadas pelo executor Node, incluindo os grupos de cenários. As duas suítes de interface foram executadas separadamente, cada uma em seu próprio banco temporário. Usaram o frontend compilado, sessões independentes e chamadas ao backend real do teste. [Erros JavaScript da seleção](validacao-cursos-restritos/web-errors.json) e [do formulário pago](validacao-cursos-restritos/admin-web-errors.json): nenhum.

Os 30 testes comerciais e os seis testes da interface paga passaram, incluindo validação de preço, rascunho sem preço e publicação com preço e condições completas. O fluxo de pagamentos continua com o provedor de teste da suíte isolada; esta validação não realizou compras reais.

Os fluxos administrativos e de alunos foram exercitados na versão web do mesmo frontend. A exportação Android/iOS verifica a geração dos bundles; não substitui execução em iPhone físico nem geração de APK/IPA assinado.

Durante cada execução isolada, as contagens e hashes das 14 tabelas do banco configurado permaneceram iguais antes e depois: [seleção de alunos](validacao-cursos-restritos/database-preservation-restricted.json) e [regressão da interface paga](validacao-cursos-restritos/database-preservation.json). A [auditoria final](validacao-cursos-restritos/audit-final.json) confirma a lista de alterações de código, a preservação dos patches Git anteriores, a remoção dos bancos temporários e a disponibilidade dos serviços backend/Metro. Nenhum curso real foi criado ou modificado para esses testes.

Para repetir as verificações persistentes:

```powershell
# Terminal do backend
cd C:\Users\camila.aguiar\Documents\development\joanalia\backend
npm test
npm run test:integracao:isolada

# Terminal do frontend
cd C:\Users\camila.aguiar\Documents\development\joanalia\frontend
npm run typecheck
npm run lint
```

O executor isolado usa a conexão do `.env` para clonar o esquema; o usuário do MySQL precisa das permissões de criar e remover o banco temporário. As credenciais não são registradas nas evidências.

Capturas: [seleção preparada](validacao-cursos-restritos/selecao-preparada.png), [Meus cursos autorizado](validacao-cursos-restritos/meus-cursos-autorizado.png), [revogação preparada](validacao-cursos-restritos/revogacao-pendente.png), [gerenciamento pelo aluno](validacao-cursos-restritos/acessos-pelo-aluno.png) e [validação de preço preservada](validacao-cursos-restritos/admin-price-required.png).
