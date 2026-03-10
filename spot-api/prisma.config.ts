import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

// Prisma 7 config — used by migrate and generate tooling
// Runtime connection is handled by src/db.ts using DATABASE_URL env var
export default defineConfig({
    earlyAccess: true,
    schema: path.resolve(import.meta.dirname, 'prisma/schema.prisma'),
})
