import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const { data, error } = await supabase.from('episodes').select('*').limit(5)
if (error) {
  console.error('error:', error.message, error.details ?? '')
} else {
  console.log('episodes:', JSON.stringify(data, null, 2))
  console.log(`total rows in result: ${data?.length ?? 0}`)
}
