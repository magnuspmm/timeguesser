import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import {
  buildEscPosReceipt,
  buildScoreReceipt,
  printEscPos,
} from './server/thermalUsb.ts'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.resolve(rootDir, 'public')
const CHALLENGES_JSON = path.join(PUBLIC, 'challenges.json')
const CHALLENGES_DIR = path.join(PUBLIC, 'challenges')

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(data)
}

function safeId(raw: string): string | null {
  const id = raw.trim()
  if (!id || id.length > 64) return null
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null
  return id
}

function safeExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
  return allowed.has(ext) ? ext : '.png'
}

function ensureDirs(): void {
  fs.mkdirSync(CHALLENGES_DIR, { recursive: true })
  if (!fs.existsSync(CHALLENGES_JSON)) {
    fs.writeFileSync(
      CHALLENGES_JSON,
      `${JSON.stringify({ challenges: [] }, null, 2)}\n`,
      'utf8',
    )
  }
}

function challengesApiPlugin(): Plugin {
  return {
    name: 'timeguesser-challenges-api',
    configureServer(server) {
      ensureDirs()
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/api/')) {
          next()
          return
        }

        try {
          if (url === '/api/print' && req.method === 'POST') {
            const body = await readBody(req)
            let payload: Buffer
            try {
              const parsed = body.length
                ? (JSON.parse(body.toString('utf8')) as Record<string, unknown>)
                : {}

              if (typeof parsed.escposBase64 === 'string') {
                const raw = parsed.escposBase64.trim()
                if (!raw) {
                  sendJson(res, 400, { error: 'Tom escposBase64' })
                  return
                }
                payload = Buffer.from(raw, 'base64')
                if (!payload.length) {
                  sendJson(res, 400, { error: 'Ugyldig base64' })
                  return
                }
                // Guard against accidental huge payloads
                if (payload.length > 2_000_000) {
                  sendJson(res, 400, { error: 'Payload for stor' })
                  return
                }
              } else if (typeof parsed.score === 'number') {
                const score = parsed.score
                const totalScore =
                  typeof parsed.totalScore === 'number'
                    ? parsed.totalScore
                    : score
                const round =
                  typeof parsed.round === 'number' ? parsed.round : 1
                const rounds =
                  typeof parsed.rounds === 'number' ? parsed.rounds : 1
                payload = buildScoreReceipt({
                  score,
                  totalScore,
                  round,
                  rounds,
                })
              } else {
                const text =
                  typeof parsed.text === 'string' && parsed.text.trim()
                    ? parsed.text.trim().slice(0, 200)
                    : 'Hello World'
                payload = buildEscPosReceipt(text)
              }
            } catch {
              sendJson(res, 400, { error: 'Ugyldig JSON' })
              return
            }

            try {
              const { bytesWritten } = await printEscPos(payload)
              sendJson(res, 200, {
                ok: true,
                bytesWritten,
                printer: 'GEZHI micro-printer (USB)',
              })
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              console.error('[print-api]', msg)
              sendJson(res, 500, {
                error: `Utskrift feilet: ${msg}`,
              })
            }
            return
          }

          if (!url.startsWith('/api/challenges')) {
            sendJson(res, 404, { error: 'Not found' })
            return
          }

          if (url === '/api/challenges' && req.method === 'GET') {
            ensureDirs()
            const raw = fs.readFileSync(CHALLENGES_JSON, 'utf8')
            sendJson(res, 200, JSON.parse(raw))
            return
          }

          if (url === '/api/challenges' && req.method === 'POST') {
            const body = await readBody(req)
            const parsed = JSON.parse(body.toString('utf8')) as {
              challenges?: unknown
            }
            if (!Array.isArray(parsed.challenges)) {
              sendJson(res, 400, { error: 'Forventet { challenges: [] }' })
              return
            }
            ensureDirs()
            fs.writeFileSync(
              CHALLENGES_JSON,
              `${JSON.stringify({ challenges: parsed.challenges }, null, 2)}\n`,
              'utf8',
            )
            sendJson(res, 200, { ok: true })
            return
          }

          if (url === '/api/challenges/image' && req.method === 'POST') {
            const id = safeId(String(req.headers['x-challenge-id'] ?? ''))
            const filename = String(req.headers['x-filename'] ?? 'image.png')
            if (!id) {
              sendJson(res, 400, {
                error: 'Ugyldig id (kun a-z, 0-9, _, -)',
              })
              return
            }
            const ext = safeExt(filename)
            const relative = `challenges/${id}${ext}`
            const dest = path.join(PUBLIC, relative)
            ensureDirs()
            const body = await readBody(req)
            if (!body.length) {
              sendJson(res, 400, { error: 'Tom bildefil' })
              return
            }
            fs.writeFileSync(dest, body)
            sendJson(res, 200, { image: relative })
            return
          }

          sendJson(res, 404, { error: 'Not found' })
        } catch (err) {
          console.error('[challenges-api]', err)
          sendJson(res, 500, { error: 'Lagring feilet' })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [challengesApiPlugin()],
})
