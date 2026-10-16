# Duração, múltiplos vídeos e progresso

As alterações reutilizam Expo 57, Express, JWT, armazenamento de mídia e MySQL existentes. Nenhuma dependência foi instalada e nenhuma mudança de esquema foi necessária. A migração existente de vídeos antigos foi validada em banco temporário. Os servidores de desenvolvimento permaneceram em execução.

## Comportamento

- Duração automática por arquivo/player, com soma total apenas quando todos os vídeos tiverem duração conhecida.
- Cadastro, edição, substituição, remoção e reordenação dentro da mesma aula. IDs estáveis preservam o progresso ao reordenar.
- Player no topo, relógio sob título/descrição, lista compacta apenas para vários vídeos e percentual considerando todos eles.
- Salvamento por aluno, aula e vídeo; retomada após preparar o player; reinício; avanço automático; conclusão somente após todos os vídeos.
- Conclusões de vídeos já finalizados são mantidas. Adicionar um vídeo exige concluir esse vídeo para que a aula volte a ficar concluída.
- Checkpoints antigos de arquivos substituídos são recusados; pendências de vídeos removidos deixam de bloquear os demais salvamentos.
- Reprodução web com URLs assinadas restritas à mídia, sem usar o token da sessão na URL. Conta, termos, matrícula e sequência continuam verificados.

## Persistência

`progresso_videos` usa a chave usuário + vídeo; `aula_videos` associa o vídeo à aula. `progresso_aulas` guarda último vídeo e conclusão geral. Transações com bloqueio da aula evitam que duas conclusões simultâneas deixem um resultado incompleto.

Checkpoints periódicos têm intervalo mínimo de 10 segundos. Pausa, troca, saída, segundo plano e ocultação da página também salvam. Falhas deixam uma fila local por usuário: SecureStore no aplicativo nativo e localStorage no navegador. A fila compacta checkpoints e serializa envios, preservando conclusão pendente mesmo após reinício. Há novas tentativas a cada 15 segundos, na abertura e ao recuperar a conexão. A interface só confirma conclusão após resposta real da API. Requisições web usam `keepalive` ao sair.

O login web permanece em memória como antes; reabrir a página exige novo login, mas o progresso permanece no servidor. Não foi criado um serviço adicional de sincronização.

## Arquivos de implementação alterados

| Arquivo | Alteração |
| --- | --- |
| `backend/src/config/auth.js` | Credenciais assinadas restritas à mídia, separadas da sessão. |
| `backend/src/middlewares/auth.js` | Autenticação do streaming web e validação da conta. |
| `backend/src/routes/catalogoRoutes.js` | Middleware de mídia nas rotas de streaming. |
| `backend/src/controllers/aulaController.js` | Duração por metadados, retomada, transações, tolerância e versão da mídia. |
| `backend/src/controllers/adminConteudoController.js` | Remoção, recomposição da conclusão e preservação dos vídeos mantidos. |
| `backend/src/utils/cursos.js` | Conclusão acadêmica conforme todos os vídeos atuais. |
| `frontend/src/app/lesson/[id].tsx` | Integração dos players, duração, fila, eventos de saída e percentual. |
| `frontend/src/app/admin/lesson-form.tsx` | Leitura da duração de vídeo com player apropriado. |
| `frontend/src/services/catalog-api.ts` | Contratos de mídia, metadados e progresso. |
| `frontend/src/services/auth-api.ts` | Suporte a `keepalive`. |
| `frontend/src/components/lesson-video.tsx` | Player nativo com preparação e retomada. Novo. |
| `frontend/src/components/lesson-video.web.tsx` | Player HTML com streaming autenticado. Novo. |
| `frontend/src/components/lesson-video.types.ts` | Contrato comum dos players. Novo. |
| `frontend/src/components/video-duration-probe.tsx` | Metadados do vídeo no cadastro nativo. Novo. |
| `frontend/src/components/video-duration-probe.web.tsx` | Metadados do vídeo no cadastro web. Novo. |
| `frontend/src/services/progress-store.ts` | Pendências em SecureStore por usuário. Novo. |
| `frontend/src/services/progress-store.web.ts` | Pendências em localStorage por usuário. Novo. |
| `frontend/src/services/progress-sync.ts` | Envio autenticado e descarte de mídia obsoleta. Novo. |
| `frontend/src/utils/progress-queue.ts` | Fila persistente, compactação e serialização. Novo. |
| `frontend/src/utils/lesson-progress.ts` | Cálculos de duração, percentual e retomada. Novo. |

## Testes e documentação alterados

- `backend/integracao/aulas.js`: duração, retomada, isolamento, edição, conclusão simultânea, URLs web e compatibilidade.
- `backend/test/videos.test.js`: tolerância, duração desconhecida e escopo das credenciais de mídia. Novo.
- `backend/scripts/testar-integracao-isolada.js`: inclui a suíte de aulas no banco temporário.
- `backend/scripts/validar-aulas-web.js`: validação real de reprodução no Edge com banco e navegador temporários. Novo.
- `frontend/test/lesson-progress.test.cjs`: regressões da fila e dos cálculos de progresso. Novo.
- `backend/README.md`, `frontend/README.md` e este relatório: contratos, persistência e reprodução dos testes.
- `validacao-aulas/web-result.json` e três capturas PNG: evidências da validação web. A pasta `validacao-aulas/web` contém a exportação local usada pelo teste.

## Validação realizada

- Backend: `npm test` — 52 testes aprovados.
- Integração: `npm run test:integracao:isolada` — 64 testes aprovados, incluindo aulas, compras e cursos restritos. Contagens e hashes das 16 tabelas originais foram preservados.
- Frontend: `npm run lint` e `npm run typecheck` aprovados.
- Fila/progresso: `node --test test/lesson-progress.test.cjs` — 9 testes aprovados.
- Compilação: exportação web com React Compiler aprovada para as 31 rotas.
- Navegador: MP4 real decodificado; pausa, reabertura e novo login com retomada; reinício; avanço automático; conclusão de todos os vídeos; ausência de lista em vídeo único; queda de conexão, reabertura com checkpoint local e envio posterior; isolamento entre duas alunas. Sem exceções JavaScript. Banco original preservado.

A reprodução prática foi validada na web. Android/iOS foram verificados por tipos e lint; não foram executados em dispositivo ou emulador nesta sessão.

A limitação de cabeçalhos do player web foi conferida na [documentação do Expo Video 57](https://docs.expo.dev/versions/v57.0.0/sdk/video/).
