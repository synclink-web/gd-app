import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing env vars:')
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', url ? '✅' : '❌ NOT SET')
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', key ? '✅' : '❌ NOT SET')
  process.exit(1)
}

const supabase = createClient(url, key)

async function main() {
  const { data, error } = await supabase.from('memories').select('*')
  console.log('memories:', JSON.stringify(data, null, 2))
  console.log('error:', error)
}

main()
