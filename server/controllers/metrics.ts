import { Db } from '../pg'
import { Express } from 'express'

export default function MetricController(db: Db, app: Express) {
  const table = (i: number) => `day_${i.toString().padStart(2, '0')}`

  app.get('/api/metrics', async (req, res) => {
    const current = new Date().getUTCDay()
    const prior = (new Date().getUTCDay() + 6) % 7

    const query = `
      WITH umetrics AS (
        SELECT 
          * FROM metrics.${table(current)} WHERE created_at > now() - interval '24 hours'
        UNION 
          ALL
        SELECT 
          * FROM metrics.${table(prior)} WHERE created_at > now() - interval '24 hours'
        )
      SELECT 
        action,
        parcel,
        to_char(date_trunc('hour', created_at), 'fmHH12am') as t
      FROM 
        umetrics
      ORDER BY 
        created_at DESC
      LIMIT 
        9000
    `

    try {
      var result = await db.query('sql/get-metrics', query)
    } catch (e) {
      res.status(500).send({ ok: false })
      return
    }

    res.status(200).send({ ok: true, metrics: result.rows })
  })
}
