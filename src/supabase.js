import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function testerConnexion() {
const { error } = await supabase.auth.getSession();

  if (error) {
    console.error('Erreur Supabase :', error.message);
  } else {
    console.log('Client Supabase initialisé correctement.');
  }
}