// Sauvegardes de la base : liste, sauvegarde immédiate, téléchargement.
import { createReadStream } from 'node:fs'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { BackupListSchema, BackupParams, BackupSchema } from '../schemas/backups.ts'
import { errorResponses } from '../schemas/common.ts'
import { badRequest, notFound } from '../http/errors.ts'

const tags = ['Sauvegardes']

export const backupRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const backups = app.settings.backups

  app.get(
    '/backups',
    { schema: { tags, summary: 'Sauvegardes de la base SQLite', response: { 200: BackupListSchema } } },
    async () =>
      backups
        ? { enabled: true, dir: backups.dir, keep: backups.keep, backups: await backups.list() }
        : { enabled: false, dir: '', keep: 0, backups: [] },
  )

  app.post(
    '/backups',
    { schema: { tags, summary: 'Sauvegarder la base maintenant', response: { 201: BackupSchema, ...errorResponses(400) } } },
    async (_request, reply) => {
      if (!backups) throw badRequest('Sauvegardes indisponibles (base en mémoire)')
      return reply.code(201).send(await backups.create('manual'))
    },
  )

  app.get(
    '/backups/:name',
    { schema: { tags, summary: 'Télécharger une sauvegarde (fichier SQLite)', params: BackupParams, produces: ['application/vnd.sqlite3'] } },
    async (request, reply) => {
      const file = backups ? await backups.file(request.params.name) : null
      if (!file) throw notFound('Sauvegarde introuvable')
      return reply
        .header('content-type', 'application/vnd.sqlite3')
        .header('content-disposition', `attachment; filename="${request.params.name}"`)
        .send(createReadStream(file))
    },
  )
}
