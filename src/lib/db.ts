import { PrismaClient } from '@prisma/client'

/**
 * Database configuration for Supabase (PostgreSQL).
 *
 * Required environment variables:
 *   DATABASE_URL  — Supabase connection pooler URL (transaction mode)
 *                   Format: postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true
 *   DIRECT_URL    — Supabase direct connection URL (for migrations)
 *                   Format: postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error(
      '[DB] DATABASE_URL is not set. ' +
      'Please set it to your Supabase connection pooler URL. ' +
      'Format: postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true'
    )
  }

  console.log(`[DB] Connecting to Supabase PostgreSQL...`)

  return new PrismaClient({
    log: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['query', 'error', 'warn'],
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

// Cache the client to prevent multiple instances in dev (hot reload)
if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = db
}