# Sistema de Repasse de Carga

React + Tailwind CSS + Supabase (Auth, Postgres, Realtime). Deploy sugerido: Vercel.

## 1. Estrutura de dados (resumo)

```
profiles                       cargas
--------                       ------
id (PK, = auth.users.id)       id (PK)
full_name                      route_number
role  [passador|programador    driver_name
       |admin]                 load_date
active                         has_schedule
created_at                     schedule_at
                                observations
                                passador_id     -> profiles.id  (quem enviou)
                                programador_id   -> profiles.id  (quem recebeu)
                                status  [pendente|concluida]
                                created_at
                                completed_at
```

Duas FKs em `cargas` apontando para a mesma tabela `profiles` é o que
modela "quem enviou e quem recebeu": `passador_id` e `programador_id`.
Não existe uma tabela `status` separada porque hoje só há dois estados —
isso é um `check constraint`, mais simples e mais rápido de consultar. O
`schema.sql` já deixa comentado como evoluir para uma tabela de histórico
de status caso o fluxo cresça (ex: "em rota", "cancelada").

Rode `schema.sql` inteiro no SQL Editor do seu projeto Supabase. Ele cria
as tabelas, os índices usados pelas telas, a trigger que carimba
`completed_at`, e as políticas de Row Level Security.

## 2. Fluxo de negócio (backend)

1. **Repasse**: um Passador preenche o formulário. O `insert` em `cargas`
   grava `passador_id = auth.uid()` (o próprio usuário logado) e
   `programador_id` = quem foi escolhido no dropdown. Status nasce como
   `pendente`.
2. **Fila de trabalho**: a tela do Programador faz
   `select * from cargas where programador_id = auth.uid() and status = 'pendente'`.
   Um canal Realtime (`postgres_changes`) mantém a fila atualizada sem
   precisar dar F5 quando uma nova carga chega.
3. **Concluir**: ao clicar "OK", roda um `update cargas set status = 'concluida' where id = ...`.
   Uma trigger no banco (`set_completed_at`) carimba `completed_at = now()`
   automaticamente — o frontend não precisa mandar esse timestamp.
4. **Acompanhamento do Passador**: mesma tabela, filtrando por
   `passador_id = auth.uid()`, mostrando o status atual em tempo real.
5. **Histórico do Programador**: filtra `status = 'concluida'` +
   `completed_at` dentro do período escolhido (semana/mês/tudo).
6. **Admin**: CRUD sobre `profiles`. Criar um usuário faz duas escritas em
   sequência — primeiro `supabase.auth.signUp` (cria o login), depois
   `insert` em `profiles` usando o mesmo `id` (cria o perfil de negócio
   com o papel escolhido). Assim que o profile é criado com
   `role = 'programador'`, ele já aparece automaticamente no dropdown
   "Delegar para" da tela de Repasse, porque esse dropdown só faz
   `select ... where role = 'programador' and active = true`.

### Segurança (RLS)

Toda a lógica de "quem pode ver/editar o quê" está garantida no banco,
não só no frontend:
- Passador só enxerga e só insere cargas onde `passador_id = auth.uid()`.
- Programador só enxerga e só atualiza cargas onde `programador_id = auth.uid()`.
- Admin enxerga e edita tudo.

Isso significa que mesmo que alguém manipule o app pelo DevTools, o banco
recusa qualquer leitura/escrita fora do escopo do papel do usuário.

## 3. Rodando o projeto

```bash
npm create vite@latest carga-dispatch -- --template react
cd carga-dispatch
npm install @supabase/supabase-js
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Copie os arquivos deste pacote para dentro do projeto gerado:
- `src/App.jsx`
- `src/index.css`
- `src/supabaseClient.js`
- `tailwind.config.js`
- `schema.sql` → rode no SQL Editor do Supabase

Crie um `.env` na raiz:
```
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-anon-key
```

> Recomendo criar um **projeto Supabase novo** para este sistema — é um
> domínio de dados diferente do seu sistema de ofícios/doações, então vale
> manter separado.

### Populando a equipe inicial

O jeito mais rápido: depois do deploy, logue como admin (crie o primeiro
admin manualmente via Authentication > Add user no painel Supabase + um
`insert` em `profiles` com `role = 'admin'`) e cadastre os outros 9 pela
própria tela de Admin do app:

- Passadores: Abimael, Guilherme, Kauê, Luiz Salomão, Fátima
- Programadores: Andrey Peres, Júlio Césa­r, Ane, Susane

## 4. Telas entregues

| Tela | Papel | Arquivo/Componente |
|---|---|---|
| Login | todos | `AuthScreen` |
| Repasse de Carga | Passador | `RepasseCarga` |
| Acompanhamento | Passador | `AcompanhamentoPassador` |
| Fila de Trabalho | Programador | `FilaTrabalho` |
| Histórico | Programador | `HistoricoProgramador` |
| Equipe (CRUD) | Admin | `AdminPainel` |

Design: paleta "manifesto de carga" (asfalto + laranja de segurança),
tipografia condensada para títulos/rotas (Barlow Condensed) e mono para
códigos de rota (JetBrains Mono). Os cards de carga têm uma borda
tracejada lateral lembrando o canhoto de um manifesto — o elemento visual
que amarra o sistema.
