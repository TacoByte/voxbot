import type { Express, Request, Response } from 'express'

async function parseTime(req: Request, res: Response) {
  const { input, now: rawNow, tz: rawTz } = req.body
  if (!input) return res.json({ error: 'no input' })

  const nowDate = new Date(rawNow)
  const now = isNaN(nowDate.getTime()) ? new Date().toISOString() : nowDate.toISOString()

  let tz = 'UTC'
  try {
    Intl.DateTimeFormat(undefined, { timeZone: rawTz })
    tz = rawTz
  } catch {
    // invalid tz, fall back to UTC
  }

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: `Current time: ${now} (timezone: ${tz}). Parse this into ISO 8601: "${input}". Reply with ONLY the ISO string, nothing else.` }],
    }),
  }).then((r) => r.json())

  const iso = r.choices?.[0]?.message?.content?.trim()
  if (!iso) return res.json({ error: 'parse failed' })
  res.json({ iso })
}

export default function ModelsController(app: Express) {
  app.post('/api/models/time', parseTime)
}
