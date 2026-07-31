import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://somqvgvzwkvzvfmvtwyb.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_hM5fJm0eVETgOOAI5D6PSg_qh5mqwVh';

export const supabase = createClient(supabaseUrl, supabaseKey);
