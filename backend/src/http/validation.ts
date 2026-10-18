// Validation des requêtes avec deux instances Ajv :
// - corps JSON : aucune conversion de type (null, "50" ou true ne deviennent pas 0, 50 ou 1) ;
// - querystring, params et en-têtes : les chaînes sont converties (« ?hoursPerDay=7 », « ?type=BUG » → ["BUG"]).
import { Ajv, type Options } from 'ajv'
import ajvFormats from 'ajv-formats'
import type { FastifySchemaCompiler } from 'fastify'

// Paquet CommonJS : depuis l'ESM, l'import par défaut est module.exports, dont .default est le plugin.
const addFormats = ajvFormats.default

function createAjv(coerceTypes: Options['coerceTypes']): Ajv {
  // Options par défaut de Fastify, sauf removeAdditional : un champ inconnu est refusé, pas ignoré.
  // allErrors reste à false (un rapport d'erreurs exhaustif ouvre la porte aux dénis de service).
  const ajv = new Ajv({ coerceTypes, useDefaults: true, removeAdditional: false, addUsedSchema: false, allErrors: false })
  addFormats(ajv)
  return ajv
}

export function createValidatorCompiler(): FastifySchemaCompiler<object> {
  const body = createAjv(false)
  const other = createAjv('array')
  return ({ schema, httpPart }) => (httpPart === 'body' ? body : other).compile(schema)
}
