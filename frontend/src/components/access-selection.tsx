import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { QueryState, confirmAction, errorMessage } from '@/components/admin-scaffold';
import { BrandIcon } from '@/components/brand-icon';
import { ChoiceChips, FormError, SmallButton, TextField } from '@/components/form';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { useAuthorizedQuery } from '@/hooks/use-authorized-query';
import {
  fetchAllAdminAccesses, fetchAdminCourses, grantAccess, revokeAccess, searchStudents, statusLabels,
  type AccessGrantInput, type AdminAccess, type Student,
} from '@/services/admin-api';
import { accessStatusLabels } from '@/services/commerce-api';
import { formatAccessTerm, formatDate, parseDate } from '@/utils/format';

type Term = 'curso' | 12 | 24 | null;
export type PreparedAccessChanges = {
  conceder: (AccessGrantInput & { aluno: Student })[];
  revogar: number[];
};
const selectedAccess = (access?: AdminAccess) => access?.situacao === 'ativo' || access?.situacao === 'agendado';

function CheckboxRow({ label, description, checked, disabled, onPress, children }: {
  label: string; description: string; checked: boolean; disabled?: boolean; onPress: () => void; children?: ReactNode;
}) {
  return (
    <View style={[styles.row, checked && styles.selected]}>
      <Pressable accessibilityRole="checkbox" accessibilityLabel={`${label}, ${description}`}
        aria-checked={checked} aria-disabled={disabled}
        accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}>
        <View style={[styles.checkbox, checked && styles.checked]}>
          {checked && <BrandIcon name="check" size={14} color={Brand.white} />}
        </View>
        <View style={styles.person}>
          <Text style={styles.name}>{label}</Text>
          <Text style={styles.hint}>{description}</Text>
        </View>
      </Pressable>
      {children}
    </View>
  );
}

function TermChoices({ value, onChange, defaultTerm }: { value: Term; onChange: (value: Term) => void; defaultTerm: number | null }) {
  return <ChoiceChips<Term> label="Prazo individual" options={[
    { value: 'curso', label: `Padrão do curso (${formatAccessTerm(defaultTerm)})` },
    { value: 12, label: '12 meses' }, { value: 24, label: '24 meses' }, { value: null, label: 'Sem vencimento' },
  ]} value={value} onChange={onChange} />;
}

function AccessInfo({ access }: { access: AdminAccess }) {
  return <Text style={styles.status}>
    {accessStatusLabels[access.situacao]} · início {formatDate(access.inicioEm)} ·{' '}
    {access.expiraEm ? `vencimento ${formatDate(access.expiraEm)}` : 'sem vencimento'}
  </Text>;
}

/** Seleção preparada no formulário; nenhuma permissão é gravada antes de salvar o curso. */
export function CourseStudentsEditor({ courseId, defaultTerm, value, onChange, onReadyChange, disabled }: {
  courseId?: number; defaultTerm: number | null; value: PreparedAccessChanges;
  onChange: (value: PreparedAccessChanges) => void; onReadyChange: (ready: boolean) => void; disabled: boolean;
}) {
  const { authorized } = useAuth();
  const load = useCallback((token: string) => courseId === undefined
    ? Promise.resolve([] as AdminAccess[]) : fetchAllAdminAccesses(token, { cursoId: String(courseId) }), [courseId]);
  const accesses = useAuthorizedQuery(load);
  const [text, setText] = useState('');
  const [results, setResults] = useState<Student[]>();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState<number>();
  const searchId = useRef(0);
  useEffect(() => { onReadyChange(!accesses.loading && !accesses.error); }, [accesses.loading, accesses.error, onReadyChange]);

  const search = async () => {
    const current = ++searchId.current;
    setSearching(true); setError(undefined);
    try {
      const found = await authorized((token) => searchStudents(token, text.trim()));
      if (current === searchId.current) setResults(found);
    } catch (cause) { if (current === searchId.current) setError(errorMessage(cause)); }
    finally { if (current === searchId.current) setSearching(false); }
  };
  const records = new Map((accesses.data ?? []).map((access) => [access.aluno.id, access]));
  const people = new Map<number, Student>();
  for (const access of records.values()) people.set(access.aluno.id, access.aluno);
  for (const grant of value.conceder) people.set(grant.usuarioId, grant.aluno);
  for (const person of results ?? []) people.set(person.id, person);
  const additions = new Map(value.conceder.map((grant) => [grant.usuarioId, grant]));
  const isSelected = (id: number) => additions.has(id) || (selectedAccess(records.get(id)) && !value.revogar.includes(id));
  const selected = [...people.keys()].filter(isSelected).length;
  const active = [...records.values()].filter((record) => record.situacao === 'ativo').length;
  const changeGrant = (person: Student, term: Term = 'curso') => onChange({
    conceder: [...value.conceder.filter((item) => item.usuarioId !== person.id), {
      usuarioId: person.id, aluno: person,
      ...(term !== 'curso' ? { prazoMeses: term } : selectedAccess(records.get(person.id)) ? { prazoMeses: defaultTerm } : {}),
    }], revogar: value.revogar.filter((id) => id !== person.id),
  });
  const unselect = (person: Student) => onChange({
    conceder: value.conceder.filter((item) => item.usuarioId !== person.id),
    revogar: selectedAccess(records.get(person.id))
      ? [...value.revogar.filter((id) => id !== person.id), person.id] : value.revogar,
  });
  const toggle = (person: Student) => {
    if (!isSelected(person.id)) {
      if (selectedAccess(records.get(person.id))) {
        onChange({ ...value, revogar: value.revogar.filter((id) => id !== person.id) });
      } else changeGrant(person);
    } else if (selectedAccess(records.get(person.id))) {
      confirmAction('Revogar autorização?', `${person.nome} perderá o acesso após salvar o curso. O progresso será preservado.`,
        'Revogar acesso', () => unselect(person));
    } else unselect(person);
  };

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Alunos autorizados</Text>
    <Text accessibilityLiveRegion="polite" style={styles.status}>
      {selected} {selected === 1 ? 'aluno selecionado' : 'alunos selecionados'} · {active} com acesso ativo
    </Text>
    <Text style={styles.hint}>As alterações serão aplicadas ao salvar o curso. Alunos selecionados só poderão vê-lo depois da publicação.</Text>
    <TextField label="Pesquisar alunos por nome ou e-mail" value={text} onChangeText={setText}
      onSubmitEditing={search} returnKeyType="search" autoCapitalize="none" autoCorrect={false} maxLength={100} editable={!disabled} />
    <SmallButton icon="search" label={searching ? 'Buscando…' : 'Pesquisar alunos'} onPress={search} disabled={disabled || searching} />
    <QueryState loading={accesses.loading} error={accesses.error} hasData={accesses.data !== undefined} onRetry={accesses.reload} />
    {error && <FormError message={error} />}
    {results?.length === 0 && <Text style={styles.hint}>Nenhum aluno encontrado para essa pesquisa.</Text>}
    {results?.length === 20 && <Text style={styles.hint}>Exibindo até 20 resultados da pesquisa. Refine o nome ou o e-mail.</Text>}
    {[...people.values()].sort((a, b) => Number(isSelected(b.id)) - Number(isSelected(a.id)) || a.nome.localeCompare(b.nome)).map((person) => {
      const access = records.get(person.id);
      const grant = additions.get(person.id);
      const checked = isSelected(person.id);
      const term: Term = grant?.prazoMeses === 12 || grant?.prazoMeses === 24 || grant?.prazoMeses === null ? grant.prazoMeses : 'curso';
      return <CheckboxRow key={person.id} label={person.nome} description={person.email} checked={checked}
        disabled={disabled || accesses.loading || !!accesses.error} onPress={() => toggle(person)}>
        {access && <AccessInfo access={access} />}
        {grant && <Text style={styles.status}>Concessão ao salvar · {formatAccessTerm(term === 'curso' ? defaultTerm : term)}</Text>}
        {value.revogar.includes(person.id) && <Text style={styles.removal}>Revogação confirmada · será aplicada ao salvar</Text>}
        {checked && <SmallButton label={expanded === person.id ? 'Fechar prazo' : 'Definir prazo individual'}
          disabled={disabled} onPress={() => setExpanded(expanded === person.id ? undefined : person.id)} />}
        {checked && expanded === person.id && <View style={styles.options}>
          <TermChoices value={term} defaultTerm={defaultTerm} onChange={(next) => changeGrant(person, next)} />
          <Text style={styles.hint}>Alterar o prazo renova a autorização a partir da gravação. Manter a seleção sem alterar o prazo preserva o vencimento atual.</Text>
        </View>}
      </CheckboxRow>;
    })}
    {people.size === 0 && !accesses.loading && <Text style={styles.hint}>Pesquise alunos para preparar as autorizações deste curso.</Text>}
  </View>;
}

/** Os mesmos registros e endpoints de Gerenciar acessos, agora organizados pelo aluno. */
export function StudentCoursesEditor({ student }: { student: Student }) {
  const { authorized } = useAuth();
  const courses = useAuthorizedQuery(fetchAdminCourses);
  const load = useCallback((token: string) => fetchAllAdminAccesses(token, { usuarioId: String(student.id) }), [student.id]);
  const accesses = useAuthorizedQuery(load);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number>();
  const [term, setTerm] = useState<Term>('curso');
  const [start, setStart] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const busy = useRef(false);
  const records = new Map((accesses.data ?? []).map((access) => [access.cursoId, access]));
  const disabled = saving || accesses.loading || courses.loading || !!accesses.error || !!courses.error;
  const mutate = async (operation: (token: string) => Promise<unknown>, message: string) => {
    if (busy.current) return;
    busy.current = true; setSaving(true); setError(undefined); setNotice(undefined);
    try { await authorized(operation); setNotice(message); setEditing(undefined); accesses.reload(); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { busy.current = false; setSaving(false); }
  };
  const grant = (courseId: number, custom = false) => {
    const date = custom ? parseDate(start) : null;
    if (date === undefined) return setError('Informe uma data válida como dia/mês/ano.');
    void mutate((token) => grantAccess(token, {
      usuarioId: student.id, cursoId: courseId,
      ...(custom && { prazoMeses: term === 'curso' ? (courses.data?.find((course) => course.id === courseId)?.prazoAcessoMeses ?? null) : term }),
      ...(date !== null && { inicioEm: date }),
    }), 'Autorização registrada.');
  };
  const toggle = (courseId: number, title: string) => {
    if (selectedAccess(records.get(courseId))) {
      confirmAction('Revogar autorização?', `${student.nome} deixará de acessar "${title}". O progresso será preservado.`,
        'Revogar acesso', () => { void mutate((token) => revokeAccess(token, { usuarioId: student.id, cursoId: courseId }), 'Autorização revogada.'); });
    } else grant(courseId);
  };
  const query = text.trim().toLocaleLowerCase();
  const activeCount = [...records.values()].filter((access) => access.situacao === 'ativo').length;
  const options = (courses.data ?? []).filter((course) => course.tipoAcesso !== 'gratuito' && course.titulo.toLocaleLowerCase().includes(query));
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Cursos autorizados para {student.nome}</Text>
    <Text style={styles.status}>{activeCount} {activeCount === 1 ? 'acesso ativo' : 'acessos ativos'}</Text>
    <Text style={styles.hint}>Marque um curso para conceder acesso com o prazo padrão. Para escolher outro prazo ou início, use Definir prazo. Rascunhos só ficam disponíveis depois de publicados.</Text>
    <TextField label="Pesquisar cursos" value={text} onChangeText={setText} maxLength={100} />
    <QueryState loading={courses.loading || accesses.loading} error={courses.error ?? accesses.error}
      hasData={courses.data !== undefined && accesses.data !== undefined} onRetry={() => { courses.reload(); accesses.reload(); }} />
    {error && <FormError message={error} />}
    {notice && <Text accessibilityLiveRegion="polite" style={styles.status}>{notice}</Text>}
    {options.map((course) => {
      const access = records.get(course.id);
      return <CheckboxRow key={course.id} label={course.titulo}
        description={`${statusLabels[course.status]} · ${course.tipoAcesso === 'restrito' ? 'Restrito' : 'Pago'}`}
        checked={selectedAccess(access)} disabled={disabled} onPress={() => toggle(course.id, course.titulo)}>
        {access && <AccessInfo access={access} />}
        <SmallButton label={editing === course.id ? 'Fechar prazo' : 'Definir prazo'} disabled={disabled} onPress={() => {
          setEditing(editing === course.id ? undefined : course.id); setTerm('curso'); setStart('');
        }} />
        {editing === course.id && <View style={styles.options}>
          <TermChoices value={term} defaultTerm={course.prazoAcessoMeses} onChange={setTerm} />
          <TextField label="Data de início (opcional)" placeholder="dd/mm/aaaa" hint="Em branco, começa agora. Alterar as condições renova o prazo."
            value={start} onChangeText={setStart} maxLength={10} keyboardType="numbers-and-punctuation" />
          <SmallButton label={selectedAccess(access) ? 'Salvar prazo' : 'Conceder acesso'} disabled={disabled} onPress={() => grant(course.id, true)} />
        </View>}
      </CheckboxRow>;
    })}
    {!courses.loading && options.length === 0 && <Text style={styles.hint}>Nenhum curso pago ou restrito encontrado.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, backgroundColor: Brand.surfaceSoft, borderRadius: Radius.card, padding: 14 },
  heading: { fontFamily: Fonts.serif, fontSize: 22, lineHeight: 28, color: Brand.text },
  row: { gap: 8, padding: 12, borderRadius: Radius.tile, backgroundColor: Brand.card, borderWidth: 1, borderColor: 'transparent' },
  selected: { borderColor: Brand.primary },
  checkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  checked: { backgroundColor: Brand.primary },
  person: { flex: 1, gap: 2 },
  name: { fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 20, color: Brand.text },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: Brand.muted },
  status: { fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 18, color: Brand.primaryDeep },
  removal: { fontFamily: Fonts.sansMedium, fontSize: 12, lineHeight: 18, color: Brand.danger },
  options: { gap: 12 },
  pressed: { opacity: 0.75 },
});
