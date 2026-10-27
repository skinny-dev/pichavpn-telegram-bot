import * as schema from '../tgcloud/schema.js'
import { migrate, db, sql } from 'sdk/db'
migrate(schema)
await db.run(sql`INSERT INTO user (id, Balance) VALUES (${'1'}, ${5})`)
console.log(await db.get(sql`SELECT id, Balance FROM user WHERE id = ${'1'}`), Object.keys(schema).length, 'tables')
