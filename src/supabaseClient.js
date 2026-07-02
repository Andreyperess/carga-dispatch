import { createClient } from '@supabase/supabase-js';

// Configure estas variáveis no seu .env (Vite) ou nas Environment Variables
// do projeto na Vercel:
//   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
//   VITE_SUPABASE_ANON_KEY=sua-anon-key
//
// Dica: crie um projeto Supabase novo para este sistema (é um domínio de
// dados diferente do sistema de ofícios), rode o schema.sql nele, e cole
// a URL/key aqui.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
