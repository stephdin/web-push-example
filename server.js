import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import webpush from 'web-push'

// --- VAPID keys ---------------------------------------------------------------
// VAPID identifies this server to the browser's push service (Google, Mozilla,
// Apple). The key pair is generated once and must stay stable: subscriptions
// are bound to the public key, so a new key invalidates all existing ones.
if (!existsSync('vapid.json')) {
  writeFileSync('vapid.json', JSON.stringify(webpush.generateVAPIDKeys(), null, 2))
}
const vapid = JSON.parse(readFileSync('vapid.json', 'utf8'))
// The "subject" (mailto: or https: URL) lets push services contact you if needed.
webpush.setVapidDetails('mailto:test@example.com', vapid.publicKey, vapid.privateKey)

// --- Subscriptions -------------------------------------------------------------
// Each subscription is { endpoint, keys: { p256dh, auth } }, as produced by
// pushManager.subscribe() in the browser. The endpoint URL is unique per
// browser/device, so we use it as the ID. Kept in memory, mirrored to disk.
let subscriptions = existsSync('subscriptions.json')
  ? JSON.parse(readFileSync('subscriptions.json', 'utf8'))
  : []
const save = () => writeFileSync('subscriptions.json', JSON.stringify(subscriptions, null, 2))

const app = new Hono()

// The browser needs the public key as `applicationServerKey` to subscribe.
app.get('/api/vapid-public-key', (c) => c.json({ publicKey: vapid.publicKey }))

// Store a new subscription (ignore duplicates with the same endpoint).
app.post('/api/subscribe', async (c) => {
  const sub = await c.req.json()
  if (!sub?.endpoint) return c.json({ error: 'invalid subscription' }, 400)
  if (!subscriptions.some((s) => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub)
    save()
  }
  return c.json({ ok: true, count: subscriptions.length })
})

// Send a notification to every stored subscription.
app.post('/api/notify', async (c) => {
  // Body is optional; fall back to defaults if it's missing or not valid JSON.
  const { title = 'Test push', body = 'Hello from Hono 👋' } = await c.req.json().catch(() => ({}))
  const payload = JSON.stringify({ title, body }) // read by the `push` handler in sw.js
  const dead = new Set()
  let sent = 0

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        // web-push encrypts the payload and POSTs it to the push service.
        // TTL: seconds the push service keeps the message if the device is offline.
        // urgency 'high': deliver immediately, even if the device is in power-saving mode.
        await webpush.sendNotification(sub, payload, { TTL: 60, urgency: 'high' })
        sent++
      } catch (err) {
        // 404/410 = subscription expired or user unsubscribed -> remove it.
        if (err.statusCode === 404 || err.statusCode === 410) dead.add(sub.endpoint)
        else console.error('Push failed:', err.statusCode, err.body || err.message)
      }
    })
  )

  if (dead.size) {
    subscriptions = subscriptions.filter((s) => !dead.has(s.endpoint))
    save()
  }
  return c.json({ sent, removed: dead.size })
})

// Everything else: static files (index.html, sw.js, manifest.json, icon.png).
app.use('/*', serveStatic({ root: './public' }))

// Listens on all interfaces, so the page is reachable from the local network too.
serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`http://localhost:${info.port}`)
})
