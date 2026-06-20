import { createClient } from '@supabase/supabase-js';

const url = 'https://fnvhtawyxaufgszbbois.supabase.co';
const key = 'sb_publishable_Gs5MR6Q0wr6JlEI8jOJSQA_cwC2IYkk';

console.log('Connecting to:', url);
const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase.from('matches').select('*').limit(1);
  if (error) {
    console.error('Error fetching matches:', error);
  } else {
    console.log('Match record keys:', Object.keys(data[0] || {}));
  }
}
run();
