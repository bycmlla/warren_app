-- Execute no banco joanalia caso a tabela usuarios ainda não exista.
-- Uma tabela existente não será modificada por este comando.
CREATE TABLE IF NOT EXISTS usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL,
  senha VARCHAR(255) NOT NULL,
  telefone VARCHAR(30) NULL,
  tipo ENUM('aluno', 'admin') NULL DEFAULT 'aluno',
  status ENUM('ativo', 'inativo', 'bloqueado') NULL DEFAULT 'ativo',
  PRIMARY KEY (id),
  UNIQUE KEY usuarios_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
