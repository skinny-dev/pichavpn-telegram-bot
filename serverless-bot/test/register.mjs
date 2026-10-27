// node --no-warnings --import ./test/register.mjs …  →  `sdk` and `sdk/db` resolve to the local fakes below
import { register } from 'node:module'
register('./loader.mjs', import.meta.url)
