import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AdminOnly } from '@/components/admin-only';
import { StudentCoursesEditor } from '@/components/access-selection';
import { AdminScaffold, errorMessage } from '@/components/admin-scaffold';
import { FormError, SmallButton, TextField } from '@/components/form';
import { Brand, Fonts, Radius } from '@/constants/brand';
import { useAuth } from '@/context/auth';
import { searchStudents, type Student } from '@/services/admin-api';


export default function GrantAccessScreen() {
  return (
    <AdminOnly>
      <GrantAccess />
    </AdminOnly>
  );
}

// Liberação manual de um curso pago ou restrito. Não gera compra nem pagamento: fica registrada
// como liberação da administração, com data de início e vencimento próprios.
function GrantAccess() {
  const { authorized } = useAuth();
  const [text, setText] = useState('');
  const [students, setStudents] = useState<Student[]>();
  const [searching, setSearching] = useState(false);
  const [student, setStudent] = useState<Student>();
  const [error, setError] = useState<string>();

  const search = async () => {
    if (searching) return;
    setError(undefined);
    setSearching(true);
    try {
      setStudents(await authorized((token) => searchStudents(token, text.trim())));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSearching(false);
    }
  };

  return (
    <AdminScaffold
      title="Gerenciar acessos por aluno"
      subtitle="Busque um aluno para consultar, conceder ou revogar o acesso aos cursos.">
      <View style={styles.group}>
        <TextField
          label="Aluno"
          hint="Busque pelo nome ou pelo e-mail cadastrado."
          value={text}
          onChangeText={setText}
          onSubmitEditing={search}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={100}
        />
        <View style={styles.inline}>
          <SmallButton icon="search" label={searching ? 'Buscando…' : 'Buscar aluno'} onPress={search} disabled={searching} />
        </View>
        {students?.length === 0 && <Text style={styles.hint}>Nenhum aluno encontrado.</Text>}
        {students?.map((item) => {
          const selected = item.id === student?.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }} aria-checked={selected}
              accessibilityLabel={`${item.nome}, ${item.email}`}
              onPress={() => setStudent(item)}
              style={({ pressed }) => [styles.student, selected && styles.selected, pressed && styles.pressed]}>
              <View style={[styles.radio, selected && styles.radioSelected]} />
              <View style={styles.studentText}>
                <Text style={styles.name}>{item.nome}</Text>
                <Text style={styles.hint}>{item.email}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {error !== undefined && <FormError message={error} />}
      {student !== undefined && <StudentCoursesEditor key={student.id} student={student} />}
    </AdminScaffold>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  inline: { flexDirection: 'row' },
  hint: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 17, color: Brand.muted },
  student: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.tile,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: Brand.card,
  },
  selected: { borderColor: Brand.primary },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: Brand.primary },
  radioSelected: { borderWidth: 5 },
  studentText: { flex: 1, gap: 1 },
  name: { fontFamily: Fonts.sansMedium, fontSize: 14, color: Brand.text },
  pressed: { opacity: 0.75 },
});
