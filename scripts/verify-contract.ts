/**
 * Contract gate: validate linked `@dsh-std/*` protocol packages and framework
 * majors. The community adapter absorbs DSH harness drift. Run as
 * `node scripts/verify-contract.ts`.
 */

import { verifyContract, formatContractDrift } from '../src/std-contract.ts'

const packageRoot = import.meta.dirname + '/..'
const drift = await verifyContract(packageRoot)

if (drift.length > 0) {
  console.error('verify:contract failed — std adapter / protocol drift detected:')
  for (const line of formatContractDrift(drift)) {
    console.error(`  ${line}`)
  }
  process.exit(1)
}

console.log('verify:contract ok')
