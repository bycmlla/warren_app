// Aplica as alterações de estrutura do banco. Uso: npm run migrar
//
// É seguro executar mais de uma vez: cada passo verifica se já foi aplicado.
// Nenhuma tabela, coluna ou linha existente é removida.
const database = require('../src/config/database');
const { migrarVideosLegados } = require('../src/utils/videos');
const { migrarBannerUnico } = require('../src/utils/bannerHome');
const { garantirCapaDasAulas } = require('../src/utils/schemaAulas');

async function colunaExiste(tabela, coluna) {
  const [linhas] = await database.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabela, coluna],
  );
  return linhas.length > 0;
}

async function restricaoExiste(tabela, nome) {
  const [linhas] = await database.execute(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
    [tabela, nome],
  );
  return linhas.length > 0;
}

const TABELA = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const passos = [
  // Aplicado após a criação da tabela aulas, abaixo.
  {
    nome: 'tabela categorias',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS categorias (
        id INT NOT NULL AUTO_INCREMENT,
        nome VARCHAR(100) NOT NULL,
        descricao VARCHAR(500) NULL,
        icone VARCHAR(40) NULL,
        mostrar_home TINYINT(1) NOT NULL DEFAULT 0,
        ordem INT NOT NULL DEFAULT 0,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY categorias_nome_unique (nome)
      ) ${TABELA}`),
  },
  {
    nome: 'cursos.categoria_id',
    jaAplicado: () => colunaExiste('cursos', 'categoria_id'),
    aplicar: () => database.query('ALTER TABLE cursos ADD COLUMN categoria_id INT NULL AFTER categoria'),
  },
  {
    nome: "cursos.secao (seção da Home: 'para-voce', 'metodo', 'praticas', 'modulos')",
    jaAplicado: () => colunaExiste('cursos', 'secao'),
    aplicar: () =>
      database.query(
        "ALTER TABLE cursos ADD COLUMN secao ENUM('para-voce', 'metodo', 'praticas', 'modulos') NULL AFTER categoria_id",
      ),
  },
  {
    nome: 'cursos.progressao_sequencial',
    jaAplicado: () => colunaExiste('cursos', 'progressao_sequencial'),
    aplicar: () =>
      database.query('ALTER TABLE cursos ADD COLUMN progressao_sequencial TINYINT(1) NOT NULL DEFAULT 1 AFTER gratuito'),
  },
  {
    // Preserva a categoria em texto livre dos cursos existentes como categorias cadastradas.
    nome: 'categorias a partir de cursos.categoria',
    aplicar: async () => {
      await database.query(
        `INSERT IGNORE INTO categorias (nome)
         SELECT DISTINCT TRIM(categoria) FROM cursos
         WHERE categoria IS NOT NULL AND TRIM(categoria) <> ''`,
      );
      await database.query(
        `UPDATE cursos c JOIN categorias k ON k.nome = TRIM(c.categoria)
         SET c.categoria_id = k.id
         WHERE c.categoria_id IS NULL`,
      );
    },
  },
  {
    nome: 'cursos.categoria_id → categorias',
    jaAplicado: () => restricaoExiste('cursos', 'cursos_categoria_fk'),
    aplicar: () =>
      database.query(
        'ALTER TABLE cursos ADD CONSTRAINT cursos_categoria_fk FOREIGN KEY (categoria_id) REFERENCES categorias (id) ON DELETE RESTRICT',
      ),
  },
  {
    nome: 'tabela modulos',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS modulos (
        id INT NOT NULL AUTO_INCREMENT,
        curso_id INT NOT NULL,
        titulo VARCHAR(200) NOT NULL,
        descricao TEXT NULL,
        ordem INT NOT NULL DEFAULT 0,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY modulos_curso_ordem (curso_id, ordem),
        CONSTRAINT modulos_curso_fk FOREIGN KEY (curso_id) REFERENCES cursos (id) ON DELETE CASCADE
      ) ${TABELA}`),
  },
  {
    // arquivo: nome do vídeo ou áudio no armazenamento; link_externo: endereço do Spotify.
    nome: 'tabela aulas',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS aulas (
        id INT NOT NULL AUTO_INCREMENT,
        modulo_id INT NOT NULL,
        titulo VARCHAR(200) NOT NULL,
        descricao TEXT NULL,
        tipo ENUM('video', 'audio', 'spotify') NOT NULL,
        arquivo VARCHAR(255) NULL,
        link_externo VARCHAR(500) NULL,
        duracao_segundos INT NULL,
        ordem INT NOT NULL DEFAULT 0,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY aulas_modulo_ordem (modulo_id, ordem),
        CONSTRAINT aulas_modulo_fk FOREIGN KEY (modulo_id) REFERENCES modulos (id) ON DELETE CASCADE
      ) ${TABELA}`),
  },
  {
    nome: 'tabela progresso_aulas',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS progresso_aulas (
        usuario_id INT NOT NULL,
        aula_id INT NOT NULL,
        posicao_segundos INT NOT NULL DEFAULT 0,
        concluida TINYINT(1) NOT NULL DEFAULT 0,
        concluida_em DATETIME NULL,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (usuario_id, aula_id),
        KEY progresso_aula (aula_id),
        CONSTRAINT progresso_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
        CONSTRAINT progresso_aula_fk FOREIGN KEY (aula_id) REFERENCES aulas (id) ON DELETE CASCADE
      ) ${TABELA}`),
  },
  {
    // Direito de acesso de um aluno a um curso restrito (não gratuito).
    nome: 'tabela matriculas',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS matriculas (
        usuario_id INT NOT NULL,
        curso_id INT NOT NULL,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (usuario_id, curso_id),
        KEY matriculas_curso (curso_id),
        CONSTRAINT matriculas_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
        CONSTRAINT matriculas_curso_fk FOREIGN KEY (curso_id) REFERENCES cursos (id) ON DELETE CASCADE
      ) ${TABELA}`),
  },

  // ----- Etapa 4: termos de uso, configurações comerciais, pedidos e direitos de acesso -----
  {
    // 'gratuito' = qualquer conta inicia; 'pago' = exige compra aprovada; 'restrito' = liberação manual.
    // cursos.gratuito continua existindo e acompanha este campo.
    nome: "cursos.tipo_acesso ('gratuito', 'pago', 'restrito')",
    jaAplicado: () => colunaExiste('cursos', 'tipo_acesso'),
    aplicar: async () => {
      await database.query(
        "ALTER TABLE cursos ADD COLUMN tipo_acesso ENUM('gratuito', 'pago', 'restrito') NOT NULL DEFAULT 'restrito' AFTER gratuito",
      );
      await database.query("UPDATE cursos SET tipo_acesso = 'gratuito' WHERE gratuito = 1");
    },
  },
  {
    // Valores em centavos (inteiros), para não haver erro de arredondamento em operações financeiras.
    nome: 'cursos: preço, Pix, cartão e prazo de acesso',
    jaAplicado: () => colunaExiste('cursos', 'preco_centavos'),
    aplicar: () =>
      database.query(`ALTER TABLE cursos
        ADD COLUMN preco_centavos INT UNSIGNED NULL AFTER tipo_acesso,
        ADD COLUMN pix_habilitado TINYINT(1) NOT NULL DEFAULT 0 AFTER preco_centavos,
        ADD COLUMN pix_desconto_percentual DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER pix_habilitado,
        ADD COLUMN cartao_habilitado TINYINT(1) NOT NULL DEFAULT 0 AFTER pix_desconto_percentual,
        ADD COLUMN cartao_max_parcelas TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER cartao_habilitado,
        ADD COLUMN cartao_parcelas_sem_juros TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER cartao_max_parcelas,
        ADD COLUMN prazo_acesso_meses SMALLINT UNSIGNED NULL AFTER cartao_parcelas_sem_juros`),
  },
  {
    nome: 'aulas.demonstrativa',
    jaAplicado: () => colunaExiste('aulas', 'demonstrativa'),
    aplicar: () =>
      database.query('ALTER TABLE aulas ADD COLUMN demonstrativa TINYINT(1) NOT NULL DEFAULT 0 AFTER duracao_segundos'),
  },
  {
    // Termos de Uso e Política de Privacidade, uma linha por versão publicada. O texto de uma
    // versão nunca é alterado: mudanças entram como nova versão. hash = SHA-256 do texto.
    nome: 'tabela documentos_legais',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS documentos_legais (
        id INT NOT NULL AUTO_INCREMENT,
        tipo ENUM('termos', 'privacidade') NOT NULL,
        versao VARCHAR(20) NOT NULL,
        vigente_desde DATE NOT NULL,
        texto MEDIUMTEXT NOT NULL,
        hash CHAR(64) NOT NULL,
        exige_novo_aceite TINYINT(1) NOT NULL DEFAULT 1,
        publicado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY documentos_tipo_versao (tipo, versao)
      ) ${TABELA}`),
  },
  {
    nome: 'tabela aceites_termos',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS aceites_termos (
        id INT NOT NULL AUTO_INCREMENT,
        usuario_id INT NOT NULL,
        documento_id INT NOT NULL,
        versao VARCHAR(20) NOT NULL,
        hash CHAR(64) NOT NULL,
        aceito_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY aceites_usuario_documento (usuario_id, documento_id),
        CONSTRAINT aceites_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
        CONSTRAINT aceites_documento_fk FOREIGN KEY (documento_id) REFERENCES documentos_legais (id) ON DELETE RESTRICT
      ) ${TABELA}`),
  },
  {
    // Estrutura preparada; ainda não há cadastro nem aplicação de cupons no aplicativo.
    nome: 'tabelas cupons e cupons_cursos',
    aplicar: async () => {
      await database.query(`CREATE TABLE IF NOT EXISTS cupons (
        id INT NOT NULL AUTO_INCREMENT,
        codigo VARCHAR(40) NOT NULL,
        tipo ENUM('percentual', 'fixo') NOT NULL,
        percentual DECIMAL(5,2) NULL,
        valor_centavos INT UNSIGNED NULL,
        valido_de DATETIME NULL,
        valido_ate DATETIME NULL,
        limite_usos INT UNSIGNED NULL,
        usos INT UNSIGNED NOT NULL DEFAULT 0,
        acumula_com_pix TINYINT(1) NOT NULL DEFAULT 0,
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY cupons_codigo_unique (codigo)
      ) ${TABELA}`);
      // Sem linhas aqui, o cupom vale para todos os cursos pagos.
      await database.query(`CREATE TABLE IF NOT EXISTS cupons_cursos (
        cupom_id INT NOT NULL,
        curso_id INT NOT NULL,
        PRIMARY KEY (cupom_id, curso_id),
        CONSTRAINT cupons_cursos_cupom_fk FOREIGN KEY (cupom_id) REFERENCES cupons (id) ON DELETE CASCADE,
        CONSTRAINT cupons_cursos_curso_fk FOREIGN KEY (curso_id) REFERENCES cursos (id) ON DELETE CASCADE
      ) ${TABELA}`);
    },
  },
  {
    // Cada pedido guarda as condições contratadas (preço, desconto, parcelas, prazo): alterar o
    // curso depois não muda compras antigas. Pedidos nunca são apagados; mudam de status.
    // aberto_chave garante no máximo um pedido em aberto por aluno e curso.
    nome: 'tabela pedidos',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS pedidos (
        id INT NOT NULL AUTO_INCREMENT,
        usuario_id INT NOT NULL,
        curso_id INT NOT NULL,
        curso_titulo VARCHAR(200) NOT NULL,
        status ENUM('pendente', 'em_processamento', 'aprovado', 'recusado', 'cancelado', 'expirado', 'reembolsado', 'contestado')
          NOT NULL DEFAULT 'pendente',
        forma_pagamento ENUM('pix', 'cartao') NOT NULL,
        parcelas TINYINT UNSIGNED NOT NULL DEFAULT 1,
        preco_centavos INT UNSIGNED NOT NULL,
        desconto_centavos INT UNSIGNED NOT NULL DEFAULT 0,
        juros_centavos INT UNSIGNED NOT NULL DEFAULT 0,
        total_centavos INT UNSIGNED NOT NULL,
        valor_parcela_centavos INT UNSIGNED NOT NULL,
        prazo_acesso_meses SMALLINT UNSIGNED NULL,
        aceite_id INT NOT NULL,
        cupom_id INT NULL,
        provedor VARCHAR(30) NOT NULL,
        provedor_pagamento_id VARCHAR(100) NULL,
        pix_copia_cola TEXT NULL,
        pix_qr_base64 MEDIUMTEXT NULL,
        checkout_url VARCHAR(1000) NULL,
        recibo_url VARCHAR(1000) NULL,
        expira_em DATETIME NULL,
        aprovado_em DATETIME NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        aberto_chave VARCHAR(30) GENERATED ALWAYS AS
          (IF(status IN ('pendente', 'em_processamento'), CONCAT(usuario_id, '-', curso_id), NULL)) STORED,
        PRIMARY KEY (id),
        UNIQUE KEY pedidos_um_aberto (aberto_chave),
        UNIQUE KEY pedidos_pagamento (provedor, provedor_pagamento_id),
        KEY pedidos_usuario (usuario_id, criado_em),
        KEY pedidos_status (status, criado_em),
        CONSTRAINT pedidos_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
        CONSTRAINT pedidos_curso_fk FOREIGN KEY (curso_id) REFERENCES cursos (id) ON DELETE RESTRICT,
        CONSTRAINT pedidos_aceite_fk FOREIGN KEY (aceite_id) REFERENCES aceites_termos (id) ON DELETE RESTRICT,
        CONSTRAINT pedidos_cupom_fk FOREIGN KEY (cupom_id) REFERENCES cupons (id) ON DELETE RESTRICT
      ) ${TABELA}`),
  },
  {
    // Uma linha por confirmação recebida do provedor. evento_id é único por provedor:
    // a mesma notificação entregue duas vezes é registrada (e processada) uma única vez.
    nome: 'tabela transacoes',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS transacoes (
        id INT NOT NULL AUTO_INCREMENT,
        pedido_id INT NOT NULL,
        provedor VARCHAR(30) NOT NULL,
        evento_id VARCHAR(150) NOT NULL,
        status VARCHAR(30) NOT NULL,
        valor_centavos INT UNSIGNED NULL,
        detalhe VARCHAR(255) NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY transacoes_evento (provedor, evento_id),
        KEY transacoes_pedido (pedido_id),
        CONSTRAINT transacoes_pedido_fk FOREIGN KEY (pedido_id) REFERENCES pedidos (id) ON DELETE RESTRICT
      ) ${TABELA}`),
  },
  {
    // A matrícula passa a ser o direito de acesso completo: origem, início, vencimento e revogação.
    // O progresso das aulas fica em progresso_aulas e não depende destas colunas.
    nome: 'matriculas: origem, início, vencimento e revogação',
    jaAplicado: () => colunaExiste('matriculas', 'origem'),
    aplicar: async () => {
      await database.query(`ALTER TABLE matriculas
        ADD COLUMN origem ENUM('manual', 'compra') NOT NULL DEFAULT 'manual' AFTER curso_id,
        ADD COLUMN pedido_id INT NULL AFTER origem,
        ADD COLUMN concedido_por INT NULL AFTER pedido_id,
        ADD COLUMN inicio_em DATETIME NULL AFTER concedido_por,
        ADD COLUMN expira_em DATETIME NULL AFTER inicio_em,
        ADD COLUMN revogado_em DATETIME NULL AFTER expira_em,
        ADD COLUMN revogado_por INT NULL AFTER revogado_em,
        ADD COLUMN motivo_revogacao VARCHAR(255) NULL AFTER revogado_por,
        ADD COLUMN atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
      await database.query('UPDATE matriculas SET inicio_em = criado_em WHERE inicio_em IS NULL');
    },
  },
  {
    // Registro permanente de cada liberação e revogação (a matrícula guarda só a situação atual).
    nome: 'tabela historico_acessos',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS historico_acessos (
        id INT NOT NULL AUTO_INCREMENT,
        usuario_id INT NOT NULL,
        curso_id INT NOT NULL,
        acao ENUM('liberacao_manual', 'liberacao_compra', 'revogacao') NOT NULL,
        admin_id INT NULL,
        pedido_id INT NULL,
        inicio_em DATETIME NULL,
        expira_em DATETIME NULL,
        observacao VARCHAR(255) NULL,
        criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY historico_usuario_curso (usuario_id, curso_id)
      ) ${TABELA}`),
  },

  // ----- Vários vídeos por aula e progresso por vídeo -----
  {
    // Vídeos de uma aula, na ordem de reprodução. A duração é lida do arquivo ao salvar.
    nome: 'tabela aula_videos',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS aula_videos (
        id INT NOT NULL AUTO_INCREMENT,
        aula_id INT NOT NULL,
        titulo VARCHAR(200) NULL,
        arquivo VARCHAR(255) NOT NULL,
        duracao_segundos INT NULL,
        ordem INT NOT NULL DEFAULT 0,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY aula_videos_aula_ordem (aula_id, ordem),
        CONSTRAINT aula_videos_aula_fk FOREIGN KEY (aula_id) REFERENCES aulas (id) ON DELETE CASCADE
      ) ${TABELA}`),
  },
  {
    // Ponto de reprodução e conclusão de cada vídeo, por usuário. A conclusão da aula (todos os
    // vídeos concluídos) continua em progresso_aulas, que é o que libera a aula seguinte.
    nome: 'tabela progresso_videos',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS progresso_videos (
        usuario_id INT NOT NULL,
        video_id INT NOT NULL,
        posicao_segundos INT NOT NULL DEFAULT 0,
        concluido TINYINT(1) NOT NULL DEFAULT 0,
        concluido_em DATETIME NULL,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (usuario_id, video_id),
        KEY progresso_videos_video (video_id),
        CONSTRAINT progresso_videos_usuario_fk FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE,
        CONSTRAINT progresso_videos_video_fk FOREIGN KEY (video_id) REFERENCES aula_videos (id) ON DELETE CASCADE
      ) ${TABELA}`),
  },
  {
    // Último vídeo que o aluno assistiu na aula, para reabri-la no mesmo ponto.
    nome: 'progresso_aulas.ultimo_video_id',
    jaAplicado: () => colunaExiste('progresso_aulas', 'ultimo_video_id'),
    aplicar: () =>
      database.query(`ALTER TABLE progresso_aulas
        ADD COLUMN ultimo_video_id INT NULL AFTER posicao_segundos,
        ADD CONSTRAINT progresso_ultimo_video_fk FOREIGN KEY (ultimo_video_id) REFERENCES aula_videos (id) ON DELETE SET NULL`),
  },
  {
    // Aulas de vídeo já cadastradas: o vídeo de cada uma vira o primeiro (e único) da lista, e o
    // progresso salvo pelos alunos é levado junto. Nada é apagado.
    nome: 'vídeos das aulas existentes → aula_videos',
    aplicar: async () => {
      const convertidas = await migrarVideosLegados();
      if (convertidas > 0) console.log(`   ${convertidas} aula(s) de vídeo convertida(s)`);
    },
  },
  {
    // Configurações editáveis do aplicativo (uma linha por chave, com o valor em JSON): hoje, o
    // banner da Home. atualizado_por guarda quem publicou a última alteração.
    nome: 'tabela configuracoes',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS configuracoes (
        chave VARCHAR(60) NOT NULL,
        valor JSON NOT NULL,
        atualizado_por INT NULL,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (chave),
        CONSTRAINT configuracoes_usuario_fk FOREIGN KEY (atualizado_por) REFERENCES usuarios (id) ON DELETE SET NULL
      ) ${TABELA}`),
  },
  {
    // Banners personalizados da Home: uma linha por banner, com a imagem no armazenamento de arquivos.
    // O banner padrão (composição original) não é uma linha: fica no aplicativo e nunca se perde.
    nome: 'tabela banners_home',
    aplicar: () =>
      database.query(`CREATE TABLE IF NOT EXISTS banners_home (
        id INT NOT NULL AUTO_INCREMENT,
        nome VARCHAR(80) NOT NULL,
        imagem VARCHAR(255) NOT NULL,
        enq_x TINYINT UNSIGNED NOT NULL DEFAULT 50,
        enq_y TINYINT UNSIGNED NOT NULL DEFAULT 50,
        texto_superior VARCHAR(160) NOT NULL DEFAULT '',
        texto_superior_visivel TINYINT(1) NOT NULL DEFAULT 1,
        titulo VARCHAR(240) NOT NULL DEFAULT '',
        titulo_visivel TINYINT(1) NOT NULL DEFAULT 1,
        botao ENUM('champagne', 'white', 'dark') NOT NULL DEFAULT 'champagne',
        ativo TINYINT(1) NOT NULL DEFAULT 1,
        ordem INT NOT NULL DEFAULT 0,
        criado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
        atualizado_em DATETIME NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY banners_home_ordem (ordem)
      ) ${TABELA}`),
  },
  {
    // Converte o banner único publicado antes do carrossel (se houver) no primeiro banner da lista.
    nome: 'banner único da Home → carrossel',
    aplicar: async () => {
      if (await migrarBannerUnico()) console.log('   banner publicado convertido em banner do carrossel');
    },
  },
];

async function migrar() {
  for (const passo of passos) {
    if (passo.jaAplicado && (await passo.jaAplicado())) {
      console.log(`já aplicado: ${passo.nome}`);
      continue;
    }
    await passo.aplicar();
    console.log(`ok: ${passo.nome}`);
  }
  await garantirCapaDasAulas();
  console.log('ok: capa opcional das aulas');
}

migrar()
  .then(() => 0)
  .catch((error) => {
    console.error('Não foi possível concluir a migração:', error.code || error.message);
    return 1;
  })
  .then(async (codigo) => {
    await database.end();
    process.exitCode = codigo;
  });
