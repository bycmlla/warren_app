# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **src/app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Assets do projeto

A pasta `assets/` fica na raiz de `frontend`, ao lado de `package.json` e `app.json`. As imagens existentes foram preservadas em `assets/img1.webp` até `assets/img5.webp`. Os ícones e imagens do template Expo ficam em `assets/images/` e `assets/expo.icon/`.

Para iniciar o app, execute `npm start` dentro de `frontend`. Para conferir o código, use `npm run lint` e `npm run typecheck`.

## Aulas e progresso

A tela de aula mantém o player no topo e mostra a lista compacta somente quando há vários vídeos. O formulário permite título, substituição, remoção e reordenação dos vídeos, com duração lida automaticamente. Durações desconhecidas não são apresentadas como valores reais.

O progresso confirmado fica no MySQL da API, separado por usuário e vídeo. Durante a reprodução, há checkpoints a cada 10 segundos; pausa, troca de vídeo, saída e segundo plano também salvam. Pendências usam SecureStore em Android/iOS e localStorage na web, com chaves por usuário; são reenviadas ao abrir a aula, recuperar a conexão ou a cada 15 segundos. Essas pendências não são exibidas como conclusão confirmada. A conclusão de um vídeo é preservada ao rever ou reiniciar; a aula só conclui quando todos os vídeos atuais estiverem concluídos.

A web usa URLs assinadas para streaming, mantendo a autenticação das demais chamadas. O login web continua em memória, conforme o comportamento anterior: após reabrir a página, é necessário entrar novamente para recuperar o progresso do servidor.

`node --test test/lesson-progress.test.cjs` verifica fila persistente, interrupções, serialização, isolamento, duração e retomada. Requer Node 24 ou versão com suporte à remoção de tipos TypeScript. A validação real do navegador está em `backend/scripts/validar-aulas-web.js`.

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
