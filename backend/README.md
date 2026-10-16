# Backend Joanalia

API Node.js + Express com MySQL usando `mysql2/promise`.

## Executar

Na pasta `backend`, instale as dependências com `npm install` e configure o `.env`:

```ini
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=joanalia
PORT=3000
JWT_SECRET=
JWT_EXPIRES_IN=7d
```

`JWT_SECRET` assina as sessões e deve ter pelo menos 32 caracteres aleatórios; gere um valor com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Não versione esse valor: trocá-lo invalida todas as sessões abertas. `JWT_EXPIRES_IN` define a validade da sessão (padrão `7d`). Sem um `JWT_SECRET` válido o login responde `500` e nenhuma sessão é emitida.

O MySQL deve estar em execução, o banco `joanalia` deve existir e as credenciais devem permitir acesso a ele. Se o MySQL retornar `ER_ACCESS_DENIED_ERROR`, ajuste as credenciais no `.env` conforme a configuração local do MySQL.

O cadastro usa `id` (auto incremento), `nome`, `email`, `senha` e `telefone` na tabela `usuarios`. Nome, e-mail e senha são obrigatórios; telefone é opcional. O e-mail precisa ter um índice `UNIQUE` para impedir duplicidades, inclusive em cadastros simultâneos. Se a tabela ainda não existir, execute o arquivo `sql/usuarios.sql` no banco `joanalia`. O arquivo não é executado automaticamente e não modifica tabelas existentes.

```powershell
npm run dev
```

Para executar sem o nodemon, use `npm start`.

O servidor testa a conexão MySQL na inicialização e informa o resultado no terminal, sem exibir credenciais. Após atualizar a configuração do nodemon, reinicie `npm run dev` uma vez; a partir daí, alterações salvas no `.env` também reiniciam o servidor e recarregam a conexão.

As colunas esperadas são `nome VARCHAR(150) NOT NULL`, `email VARCHAR(150) NOT NULL`, `senha VARCHAR(255) NOT NULL` e `telefone VARCHAR(30) NULL`. A senha é armazenada como hash bcrypt com custo 12 e não aparece na resposta da API. O cadastro público sempre grava `tipo = 'aluno'` e ignora qualquer `tipo`, `role` ou `status` enviado no corpo da requisição. A coluna `tipo ENUM('aluno', 'admin')` define a permissão: a API expõe `aluno` como `role: "USER"` e `admin` como `role: "ADMIN"`.

## Cadastrar usuário

`POST http://localhost:3000/api/usuarios`, com `Content-Type: application/json`:

```json
{
  "nome": "Camila Aguiar",
  "email": "camila@email.com",
  "telefone": "71999999999",
  "senha": "Teste@1234"
}
```

Exemplo no PowerShell:

```powershell
$body = @{ nome = 'Camila Aguiar'; email = 'camila@email.com'; telefone = '71999999999'; senha = 'Teste@1234' } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3000/api/usuarios' -Method Post -ContentType 'application/json' -Body $body
```

Resposta `201`:

```json
{
  "id": 1,
  "nome": "Camila Aguiar",
  "email": "camila@email.com",
  "telefone": "71999999999",
  "role": "USER"
}
```

Nome e e-mail aceitam até 150 caracteres. A senha deve ter pelo menos 8 caracteres e até 72 bytes em UTF-8 (limite do bcrypt); espaços na senha são preservados. Se informado, o telefone deve ser texto com 10 a 15 dígitos e até 30 caracteres, podendo incluir `+`, parênteses, espaços e hifens. Telefone ausente, `null` ou vazio é gravado como `NULL`.

Respostas de erro: `400` para campos ausentes, valores inválidos ou JSON malformado; `409` para e-mail já cadastrado; `500` para falha no cadastro ou na conexão com o banco.

## Login

`POST http://localhost:3000/api/usuarios/login`, com `Content-Type: application/json`:

```json
{
  "email": "camila@email.com",
  "senha": "Teste@1234"
}
```

Use o e-mail e a senha de um usuário cadastrado. A senha é comparada com o hash bcrypt armazenado, preservando os espaços digitados. E-mail não cadastrado retorna `404` com `{"message":"E-mail não cadastrado."}`. Senha incorreta retorna `401` com `{"message":"Senha incorreta."}`.

Resposta `200`:

```json
{
  "message": "Login realizado com sucesso.",
  "token": "<JWT>",
  "usuario": {
    "id": 1,
    "nome": "Camila Aguiar",
    "email": "camila@email.com",
    "telefone": "71999999999",
    "role": "USER"
  }
}
```

Respostas de erro: `400` para campos ausentes ou inválidos; `404` para e-mail não cadastrado; `401` para senha incorreta; `403` para usuário inativo ou bloqueado após validar a senha; `500` para falha na consulta ao banco. A tabela deve conter `status ENUM('ativo', 'inativo', 'bloqueado') DEFAULT 'ativo'`, como no banco local e no SQL de criação.

O `token` é um JWT que identifica apenas o usuário (`sub`); a permissão não fica no token.

## Sessão e permissões

As rotas protegidas exigem o cabeçalho `Authorization: Bearer <token>`. A cada requisição o backend valida o token e recarrega o usuário do banco, então rebaixar ou bloquear uma conta vale imediatamente, mesmo para sessões já abertas.

- `GET /api/usuarios/me`: devolve `{ "usuario": { id, nome, email, telefone, fotoPerfil, role } }` do usuário autenticado. `fotoPerfil` vem da coluna `foto_perfil` (URL ou `null`); login e cadastro devolvem o usuário no mesmo formato.
As rotas administrativas estão listadas em "Conteúdos" abaixo. Entre elas:

- `GET /api/admin/cursos/indicadores`: contagens da tabela `cursos` para o painel — `{ "indicadores": { total, publicados, rascunhos, arquivados, destaques } }`. `publicados`, `rascunhos` e `arquivados` seguem a coluna `status` (um status nulo conta como rascunho, o padrão da coluna); `destaques` conta `destaque = 1`.
- `GET /api/admin/cursos`: lista os cursos, do mais recente para o mais antigo — `{ "cursos": [{ id, titulo, subtitulo, categoria, imagemCapa, destaque, gratuito, status, atualizadoEm }] }`.

Todas as rotas em `/api/admin` são exclusivas de `role: "ADMIN"` e passam pelos middlewares `autenticar` e `exigirAdmin` (`src/middlewares/auth.js`).

Respostas de erro: `401` sem token (`Autenticação necessária.`) ou com token inválido, expirado ou de usuário removido (`Sessão inválida ou expirada. Entre novamente.`); `403` para usuário inativo ou bloqueado e, nas rotas administrativas, para quem não é ADMIN (`Acesso restrito à administração.`).

## Criar a primeira administradora

Não existe cadastro público de administradores. A conta é criada por um comando executado no servidor:

```powershell
npm run criar-admin
```

O comando pergunta nome, e-mail e senha (mínimo de 12 caracteres, digitada sem aparecer na tela e confirmada), grava a senha com o mesmo hash bcrypt do cadastro e define `tipo = 'admin'`. Para ambientes sem terminal interativo, defina `ADMIN_NOME`, `ADMIN_EMAIL` e `ADMIN_SENHA` no ambiente antes de executar; não deixe a senha no `.env` nem no histórico do terminal.

Executar novamente com um e-mail que já é de uma administradora não altera nada. Se o e-mail pertencer a uma conta comum, o comando recusa e não muda a permissão dela.

Para confirmar, consulte `SELECT id, nome, email, tipo, status FROM usuarios WHERE tipo = 'admin';` e faça login com a conta: a resposta deve trazer `"role": "ADMIN"`, e `GET /api/admin/cursos` com o token recebido deve responder `200`.

## Banco de dados

Além de `usuarios` e `cursos`, a aplicação usa as tabelas `categorias`, `modulos`, `aulas`, `aula_videos`, `progresso_videos`, `progresso_aulas` e `matriculas`, e as colunas `cursos.categoria_id`, `cursos.secao` e `cursos.progressao_sequencial`. Para criá-las:

```powershell
npm run migrar
```

O comando é idempotente (pode ser executado mais de uma vez) e só acrescenta estrutura: nenhuma tabela, coluna ou linha existente é removida. A coluna de texto `cursos.categoria` é mantida como legado; os valores existentes viram categorias cadastradas.

- `cursos.secao`: seção da Home (`para-voce`, `metodo`, `praticas`, `modulos`) ou `NULL` (só em Explorar). É independente da categoria.
- `aulas.tipo`: `video`, `audio` ou `spotify`. Áudio guarda o arquivo em `aulas.arquivo`; Spotify guarda o endereço em `aulas.link_externo`. Vídeos ficam em `aula_videos`, com ID estável, título, arquivo, duração automática e ordem.
- `progresso_videos`: posição e conclusão por usuário + vídeo. Reordenar ou renomear preserva esses registros. Substituir o arquivo zera a posição, preservando a conclusão; remover um vídeo remove apenas o progresso desse vídeo.
- `progresso_aulas`: último vídeo selecionado (`ultimo_video_id`), posição e conclusão da aula, por usuário. Vídeos novos precisam ser concluídos para que a aula inteira fique concluída. A migração existente converte aulas de vídeo antigas e preserva seus pontos e conclusões.
- `cursos.tipo_acesso`: `gratuito` (qualquer conta inicia), `pago` (exige compra aprovada) ou `restrito` (só liberação da administração). `cursos.gratuito` é mantido por compatibilidade e acompanha esse campo. Um curso pago guarda também `preco_centavos`, `pix_habilitado`, `pix_desconto_percentual`, `cartao_habilitado`, `cartao_max_parcelas`, `cartao_parcelas_sem_juros` e `prazo_acesso_meses` (12, 24 ou `NULL` = sem vencimento). Valores em dinheiro são sempre inteiros, em centavos.
- `aulas.demonstrativa`: aula de demonstração, aberta a qualquer aluno com conta.
- `matriculas`: direito de acesso de um aluno a um curso pago ou restrito, com `origem` (`compra` ou `manual`), `inicio_em`, `expira_em` e `revogado_em`. O acesso vale enquanto não foi revogado e está dentro do período. O progresso (`progresso_aulas`) é independente: vencer ou revogar um acesso não apaga aulas concluídas.
- `historico_acessos`: registro permanente de cada liberação e revogação.
- `documentos_legais`: versões publicadas dos Termos de Uso e da Política de Privacidade (texto, data de vigência e hash SHA-256). `aceites_termos`: aceite de cada usuário (versão, hash e data/hora).
- `pedidos`: compras, com as condições contratadas (preço, desconto, parcelas, juros, total, prazo) — alterar o curso depois não muda pedidos antigos, e pedidos nunca são apagados. `transacoes`: confirmações recebidas do provedor de pagamentos, uma por evento.
- `cupons` e `cupons_cursos`: estrutura preparada para cupons promocionais; ainda sem rotas nem telas.

## Arquivos enviados

Imagens, vídeos e áudios ficam em disco, na pasta `storage/` (ou em `STORAGE_DIR`, se definido), nunca no MySQL:

- `storage/imagens/`: capas e banners, públicos em `/arquivos/imagens/<arquivo>`.
- `storage/midias/`: vídeos e áudios das aulas. Exigem acesso à aula, via `GET /api/aulas/:id/midia` ou `GET /api/aulas/:id/videos/:videoId/midia`, com suporte a `Range`.

`POST /api/admin/uploads/:tipo` (`imagem`, `video` ou `audio`) recebe o arquivo como corpo bruto da requisição, com o `Content-Type` do arquivo, e grava em disco conforme chega. O formato é conferido pelo tipo declarado e pelos primeiros bytes do arquivo. Limites padrão: 8 MB (imagem), 200 MB (áudio) e 1024 MB (vídeo), ajustáveis por `UPLOAD_MAX_IMAGEM_MB`, `UPLOAD_MAX_AUDIO_MB` e `UPLOAD_MAX_VIDEO_MB`. O envio de um arquivo pode levar até 2 horas (`UPLOAD_TIMEOUT_MIN`); o padrão do Node, de 5 minutos, interrompia vídeos grandes em conexões lentas. Atrás de um proxy (Nginx, por exemplo), ajuste também o limite de tamanho e o tempo de envio dele. Resposta `201`: `{ arquivo, tamanho, url? }`.

Faça backup de `storage/` junto com o banco e não versione a pasta. Este armazenamento atende desenvolvimento e um servidor único; para vídeos grandes e muitos alunos, o indicado é armazenamento de objetos com CDN ou uma plataforma de vídeo (envio retomável, transcodificação e streaming adaptativo não são feitos aqui).

## Conteúdos

### Administração (somente ADMIN)

- Categorias: `GET /api/admin/categorias`, `POST /api/admin/categorias`, `PUT /api/admin/categorias/:id` (parcial), `PUT /api/admin/categorias/ordem` (`{ ids }`), `DELETE /api/admin/categorias/:id`. Excluir uma categoria com cursos responde `409` com a quantidade; com `?desvincular=true` os cursos ficam sem categoria e a exclusão segue.
- Cursos: `GET /api/admin/cursos`, `POST /api/admin/cursos`, `GET /api/admin/cursos/:id` (com módulos e aulas), `PUT /api/admin/cursos/:id`, `PUT /api/admin/cursos/:id/status` (`{ status }`), `DELETE /api/admin/cursos/:id`. Rascunhos exigem só o título. Publicar exige descrição, categoria e ao menos uma aula; caso contrário responde `422` com `pendencias`.
- Módulos: `POST /api/admin/cursos/:cursoId/modulos`, `PUT /api/admin/modulos/:id`, `DELETE /api/admin/modulos/:id`, `PUT /api/admin/cursos/:cursoId/modulos/ordem`.
- Aulas: `POST /api/admin/cursos/:cursoId/aulas`, `PUT /api/admin/aulas/:id`, `DELETE /api/admin/aulas/:id`, `PUT /api/admin/modulos/:id/aulas/ordem`. Sem `moduloId`, a aula entra no único módulo do curso (criado automaticamente como "Aulas" se o curso ainda não tiver nenhum).

`cursos.total_aulas` e `cursos.duracao_minutos` são recalculados a cada alteração de aulas. Cursos, módulos e aulas que alunos já iniciaram não são excluídos (`409`), para não apagar o progresso; arquive o curso (`status: "arquivado"`). Arquivos de mídia e imagens que deixam de ser usados são removidos do armazenamento.

### Catálogo público

- `GET /api/home`: categorias marcadas com "Mostrar na Home" e os cursos publicados gratuitos/pagos de cada seção. Restritos ficam ocultos, inclusive para alunos autorizados.
- `GET /api/categorias`: categorias com ao menos um curso publicado gratuito/pago. Categorias contendo somente restritos ficam ocultas.
- `GET /api/cursos?busca=&categoriaId=&secao=&pagina=`: cursos publicados gratuitos/pagos, 12 por página (`temMais` indica se há próxima). Restritos não aparecem em pesquisas ou filtros.
- `GET /api/cursos/:id`: detalhes, módulos e aulas, sem endereços de mídia. Cursos pagos trazem `comercial` (preço, Pix, cartão e prazo). Com sessão, traz também `acesso` (`estado`: `liberado`, `comprar`, `pendente` ou `restrito`; `motivo`: `vencido`, `revogado`…; datas de início e vencimento), `termosPendentes`, o estado de cada aula (`disponivel`, `bloqueada`, `concluida`) e o `progresso`. Sem sessão, `acesso.estado` é `visitante`.

Detalhes de um restrito só são retornados ao ADMIN ou ao aluno com matrícula válida, depois da publicação. Sem autorização válida, a API responde `404`, sem retornar módulos ou dados privados. Rascunhos e arquivados continuam exclusivos de ADMIN.

### Aulas (exigem sessão)

- `GET /api/aulas/:id`: dados da aula, vídeos em ordem com progresso individual, `videoAtualId`, duração total e próxima aula. Durações desconhecidas são `null`.
- `GET /api/aulas/:id/midia`: o vídeo ou áudio, com suporte a `Range`.
- `POST /api/aulas/:id/progresso` (`{ posicaoSegundos, finalizada }`): salva áudio/Spotify; só aceita concluir uma aula de vídeo se todos os seus vídeos já estiverem concluídos.
- `POST /api/aulas/:id/videos/:videoId/progresso` (`{ posicaoSegundos, finalizado?, duracaoSegundos?, versaoMidia? }`): salva o vídeo do usuário da sessão. A duração automática do player completa metadados ausentes. Um checkpoint de um arquivo substituído é recusado com `409`, `VIDEO_SUBSTITUIDO`. A gravação é transacional e serializa conclusões simultâneas.

O cadastro recebe `videos: [{ id?, titulo?, arquivo, duracaoSegundos? }]`, na ordem desejada. Aceita também o `arquivo` único do formato anterior. A duração é lida do arquivo ou do player, nunca digitada; a soma só é exibida quando todas as durações são conhecidas.

Os campos `midiaWeb` são URLs assinadas válidas por duas horas, restritas ao caminho de um arquivo. Elas não autenticam chamadas às demais rotas. Cada requisição de mídia continua verificando conta, matrícula, aceite e sequência; bloquear/revogar acesso continua impedindo a reprodução. O aplicativo renova essas URLs ao tentar carregar novamente um vídeo.

Todas as rotas de aula conferem, a cada chamada, que o curso está publicado, que o aluno aceitou os Termos de Uso vigentes (`428` com `codigo: "TERMOS_PENDENTES"`), que ele tem acesso (ADMIN sempre; curso gratuito, qualquer conta; curso pago ou restrito, só com matrícula válida — não revogada e dentro do prazo) e, na progressão sequencial, que as aulas anteriores foram concluídas — inclusive as de módulos anteriores. Sem acesso: `403` com `codigo: "SEM_ACESSO"`; aula ainda bloqueada: `403` com `codigo: "BLOQUEADA"`. Vídeos exigem o final, com tolerância de até 2 segundos ou 2% para vídeos curtos (`422`, `INCOMPLETA`); áudio mantém a regra anterior de 90%, e Spotify é concluído manualmente. Uma aula de vídeo exige todos os vídeos atuais concluídos. Aulas demonstrativas de cursos gratuitos/pagos abrem para qualquer aluno com conta. Em cursos restritos, todas as aulas exigem autorização, inclusive as marcadas como demonstrativas.

## Termos de Uso

O aceite dos Termos de Uso vigentes é obrigatório para reproduzir aulas e para comprar, e é conferido no backend em cada uma dessas rotas — não basta o aplicativo exibir a tela.

- `GET /api/termos`: versão vigente (texto integral, versão, data e hash) e, com sessão, o aceite válido do usuário.
- `POST /api/termos/aceite` (`{ documentoId, hash, aceito: true }`): registra usuário, versão, hash e data/hora. O aplicativo devolve o documento que exibiu; se os termos mudaram nesse meio-tempo, responde `409` (`TERMOS_ATUALIZADOS`).
- `GET /api/privacidade`: Política de Privacidade vigente.

Enquanto não houver termos publicados, as aulas dos cursos liberados continuam abrindo normalmente, mas nenhuma compra pode ser iniciada (`409`, `TERMOS_INDISPONIVEIS`).

**Situação atual:** no banco de desenvolvimento está publicada a versão `1.0-minuta`, a partir de `documentos/termos-de-uso-1.0-minuta.md`. É a minuta recebida, ainda com os campos de identificação do responsável, atendimento e Política de Privacidade por preencher e pendente de revisão jurídica; serve para validar o fluxo, não para a publicação comercial. A Política de Privacidade ainda não foi fornecida. Quando o texto final estiver pronto, publique-o como versão `1.0`: os alunos serão convidados a aceitá-la.

Para publicar, salve o texto em um arquivo `.txt` ou `.md` (UTF-8, parágrafos separados por linha em branco; o aplicativo reconhece títulos com `#`, listas com `-`, negrito com `**` e citações com `>`) e execute:

```powershell
npm run publicar-documento -- termos 1.0 2026-11-01 C:\caminho\termos-de-uso.txt
npm run publicar-documento -- privacidade 1.0 2026-11-01 C:\caminho\politica-de-privacidade.txt
```

Os argumentos são tipo, versão, data de vigência e arquivo. Uma versão publicada não é alterada: mudanças entram como nova versão. Por padrão, uma nova versão dos termos exige novo aceite antes da próxima compra; para correções que não mudam direitos nem obrigações, acrescente `--sem-novo-aceite`.

## Compras e pagamentos

**Nenhum provedor de pagamentos está integrado e nenhuma cobrança é feita.** A escolha do provedor depende de decisões comerciais e das regras das lojas de aplicativos, e a integração exige credenciais que não existem neste projeto. O que está pronto é tudo o que independe do provedor:

- `GET /api/cursos/:id/oferta`: condições e formas de pagamento de um curso pago. Exige sessão e aceite dos termos.
- `POST /api/pedidos` (`{ cursoId, formaPagamento: "pix" | "cartao", parcelas }`): inicia a compra. Confere, nesta ordem: curso à venda, aceite dos termos, ausência de acesso válido e de compra em aberto, forma de pagamento habilitada e provedor ativo. Preço, desconto, juros e total são calculados no servidor; valores enviados pelo aplicativo são ignorados. Sem provedor responde `503` (`PAGAMENTO_INDISPONIVEL`) e nada é criado.
- `GET /api/pedidos`, `GET /api/pedidos/:id`, `POST /api/pedidos/:id/cancelar`: histórico, situação e desistência de uma compra ainda não paga — sempre do próprio usuário.
- `GET /api/meus-cursos`: cursos comprados ou liberados, com situação, datas e progresso.
- `POST /api/pagamentos/notificacoes/:provedor`: webhook do provedor.

Regras garantidas pelo backend:

- Criar um pedido não libera nada. O curso só é liberado quando o provedor confirma o pagamento com o valor exato do pedido; nesse momento são gravados a data de aprovação, o início do acesso (a mesma data) e o vencimento (início + prazo contratado).
- A notificação do provedor só indica qual pagamento mudou: a situação e o valor são lidos diretamente do provedor. Retorno do aplicativo ou de redirecionamento nunca confirma um pagamento.
- Há no máximo um pedido em aberto por aluno e curso (índice único), quem já tem acesso não cria pedido, e cada notificação é processada uma única vez (`transacoes.evento_id` é único). Confirmações repetidas ou simultâneas não liberam duas vezes.
- Reembolso ou contestação encerram o acesso criado por aquela compra; o pedido e o progresso do aluno são preservados.
- Dados de cartão nunca passam por este backend: o adaptador recebe apenas o que o checkout seguro do provedor devolve (ex.: um token).

Para ativar um provedor, implemente um adaptador com o contrato descrito em `src/pagamentos/index.js`, registre-o ali e defina `PAGAMENTO_PROVEDOR` no `.env`. O webhook precisa de um endereço HTTPS público.

### Administração (somente ADMIN)

- `GET /api/admin/comercial/resumo`: compras por situação, valor confirmado, acessos ativos e vencidos, provedor ativo e versão dos termos.
- `GET /api/admin/pedidos?status=&busca=` e `GET /api/admin/acessos?situacao=&busca=`: consulta de compras e de direitos de acesso.
- `GET /api/admin/alunos?busca=`: localiza alunos por nome ou e-mail.
- `POST /api/admin/acessos` (`{ usuarioId, cursoId, inicioEm?, prazoMeses? }`): libera um curso manualmente. Sem `inicioEm` o acesso começa agora; sem `prazoMeses` vale o prazo do curso. Não gera pedido nem conta como pagamento.
- `POST /api/admin/acessos/revogar` (`{ usuarioId, cursoId, motivo? }`): encerra o acesso.

A seção **Alunos autorizados** no cadastro/edição de cursos restritos usa `matriculas` e `historico_acessos`, os mesmos registros de **Gerenciar acessos por aluno**. Não há outra tabela de permissões nem migração necessária. A chave única continua sendo aluno + curso; repetir uma concessão válida sem novas condições preserva o prazo e não acrescenta outro evento de concessão. Para renovar ou alterar condições, envie `prazoMeses` e/ou `inicioEm`.

`POST /api/admin/cursos` e `PUT /api/admin/cursos/:id` aceitam, somente para restritos, o campo opcional `acessos`: `{ conceder: [{ usuarioId, prazoMeses?, inicioEm? }], revogar: [usuarioId] }`. Curso e alterações de acesso são gravados na mesma transação. Uma falha desfaz a operação inteira; enviar apenas as alterações preserva os outros alunos e seus prazos.

`GET /api/admin/acessos` também aceita `cursoId`, `usuarioId` e `pagina`, com filtros exatos e resposta `{ acessos, total, pagina, temMais }`. A seleção no formulário consulta todas as páginas. O aluno só vê restritos publicados com autorização válida em **Meus cursos**; acessos vencidos, agendados ou revogados ficam fora dessa lista. O histórico dos pagos e o progresso acadêmico continuam preservados.

Não existe rota que altere a situação de um pagamento. Um curso com compras ou acessos registrados não pode ser excluído (`409`); arquive-o.

## Testes

Execute `npm test`. Os testes fazem requisições HTTP à aplicação com o acesso ao banco simulado; não inserem dados no MySQL. A conexão real depende das credenciais e da estrutura da tabela local.

`npm run test:integracao:isolada` executa as suítes comercial, de cursos restritos e de aulas em um banco temporário, clonando somente o esquema do banco do `.env` e usando armazenamento temporário. Confere contagens e hashes do conteúdo original antes e depois, e remove o banco temporário ao finalizar. O usuário do MySQL precisa poder criar e remover esse banco temporário.

`node scripts/validar-aulas-web.js` valida reprodução real no Edge headless, retomada, conclusão e falhas de conexão. Usa banco, armazenamento e perfil do navegador temporários; não encerra os servidores existentes. Antes, exporte o frontend para `validacao-aulas/web`: `expo export --platform web --output-dir ../validacao-aulas/web` usando o executável local em `frontend/node_modules/.bin`. O teste usa um MP4 real do armazenamento original apenas como fixture de leitura.

`npm run test:integracao` executa as mesmas suítes diretamente contra o banco do `.env`, usando o provedor falso somente nos testes comerciais. Ele cria alunos, cursos e uma versão de teste dos termos com marcador próprio e apaga seus registros ao terminar. Use esse comando somente quando o `.env` já apontar para um banco exclusivo de testes; durante a execução, a versão de teste dos termos fica em vigor.
