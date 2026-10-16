// A coluna usuarios.tipo ('aluno' | 'admin') é a origem da permissão exposta pela API.
const PERFIS = { admin: 'ADMIN', aluno: 'USER' };

function usuarioPublico(usuario) {
  return {
    id: usuario.id,
    nome: usuario.nome,
    email: usuario.email,
    telefone: usuario.telefone,
    fotoPerfil: usuario.foto_perfil ?? null,
    role: PERFIS[usuario.tipo] || 'USER',
  };
}

module.exports = usuarioPublico;
