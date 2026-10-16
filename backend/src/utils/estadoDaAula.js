// Permissão de abertura e progresso são informações independentes: acesso perdido não apaga conclusão.
function bloqueioDaAula(aula, estado, curso, liberado, autenticado) {
  if (!liberado) {
    if (curso.tipo_acesso !== 'restrito' && aula.demonstrativa === 1) return autenticado ? null : 'login';
    if (!autenticado && curso.tipo_acesso === 'gratuito') return 'login';
    return 'acesso';
  }
  return estado === 'bloqueada' ? 'sequencia' : null;
}

module.exports = { bloqueioDaAula };
