import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

// One client shared by every page. Import it wherever data or auth is needed.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);