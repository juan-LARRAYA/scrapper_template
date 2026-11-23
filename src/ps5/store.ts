import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createClient, type Client } from "@libsql/client"
import type { Listing, RunSummary } from "./types.js"

let _db: Client | null = null

/** SQLite local por defecto (data/ps5.db). PS5_DB_URL/PS5_DB_TOKEN permiten usar Turso. */
export const getPs5Db = (): Client => {
  if (_db) return _db
  const url = process.env.PS5_DB_URL ?? "file:data/ps5.db"
  if (url.startsWith("file:")) mkdirSync(dirname(url.slice(5)), { recursive: true })
  _db = createClient({ url, authToken: process.env.PS5_DB_TOKEN })
  return _db
}

export const initPs5Db = async () => {
  const db = getPs5Db()
  await db.execute(`CREATE TABLE IF NOT EXISTS ps5_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    summary_json TEXT NOT NULL
  )`)
  await db.execute(`CREATE TABLE IF NOT EXISTS ps5_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    site TEXT NOT NULL, source TEXT, model TEXT NOT NULL,
    title TEXT NOT NULL, price REAL NOT NULL, currency TEXT,
    url TEXT, external_id TEXT, location TEXT
  )`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_ps5_listings_run ON ps5_listings (run_id)`)
}

export const saveRun = async (summary: RunSummary, kept: Listing[]): Promise<number> => {
  const db = getPs5Db()
  const res = await db.execute({
    sql: "INSERT INTO ps5_runs (started_at, finished_at, summary_json) VALUES (?, ?, ?)",
    args: [summary.startedAt, summary.finishedAt, JSON.stringify(summary)],
  })
  const runId = Number(res.lastInsertRowid)
  await db.batch(
    kept.map((l) => ({
      sql: `INSERT INTO ps5_listings (run_id, site, source, model, title, price, currency, url, external_id, location)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [runId, l.site, l.source, l.model, l.title, l.price, l.currency, l.url, l.externalId, l.location ?? null],
    })),
    "write",
  )
  return runId
}

export type StoredRun = { id: number; summary: RunSummary }

export const getRuns = async (limit = 50): Promise<StoredRun[]> => {
  const r = await getPs5Db().execute({
    sql: "SELECT id, summary_json FROM ps5_runs ORDER BY id DESC LIMIT ?",
    args: [limit],
  })
  return r.rows.map((row) => ({ id: Number(row.id), summary: JSON.parse(String(row.summary_json)) as RunSummary }))
}

export const getRunListings = async (runId: number) => {
  const r = await getPs5Db().execute({
    sql: "SELECT site, model, title, price, currency, url, location FROM ps5_listings WHERE run_id = ? ORDER BY model, site, price",
    args: [runId],
  })
  return r.rows.map((row) => ({
    site: String(row.site), model: String(row.model), title: String(row.title),
    price: Number(row.price), currency: row.currency ? String(row.currency) : "?",
    url: row.url ? String(row.url) : null, location: row.location ? String(row.location) : null,
  }))
}
