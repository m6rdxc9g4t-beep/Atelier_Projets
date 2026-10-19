// Serveur de l'interface compilée (frontend/dist) pour l'application de bureau, sur l'adresse « app » de la
// Suite Atelier (127.0.0.1:4174) : fichiers statiques, repli sur index.html (application monopage) et relais
// de /api vers l'API Fastify. Même origine pour l'interface et l'API : aucune configuration CORS.
'use strict'

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** Fichier de `root` désigné par le chemin d'URL, ou null s'il sort du dossier ou n'existe pas. */
function resolveFile(root, urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const file = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`)
  if (file !== root && !file.startsWith(root + path.sep)) return null
  try {
    return fs.statSync(file).isFile() ? file : null
  } catch {
    return null
  }
}

function sendFile(response, file, method) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  // Les fichiers de assets/ portent une empreinte dans leur nom : mis en cache ; index.html toujours relu.
  const immutable = file.includes(`${path.sep}assets${path.sep}`)
  response.writeHead(200, {
    'content-type': type,
    'content-length': fs.statSync(file).size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  })
  if (method === 'HEAD') return response.end()
  fs.createReadStream(file).pipe(response)
}

function proxy(request, response, apiPort) {
  const upstream = http.request(
    { host: '127.0.0.1', port: apiPort, method: request.method, path: request.url, headers: request.headers },
    (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers)
      reply.pipe(response)
    },
  )
  upstream.on('error', () => {
    if (response.headersSent) return response.destroy()
    response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ statusCode: 502, error: 'Bad Gateway', code: 'API_UNREACHABLE', message: 'L’API locale ne répond pas' }))
  })
  // Requête annulée par l'interface (fenêtre fermée, « Annuler » d'une génération IA) : l'API est prévenue.
  response.on('close', () => {
    if (!response.writableFinished) upstream.destroy()
  })
  request.pipe(upstream)
}

/**
 * Démarre le serveur. Résout avec { server, url } une fois à l'écoute ; rejette avec l'erreur d'écoute
 * (EADDRINUSE si le port est pris).
 */
function startUiServer({ root, port, apiPort, host = '127.0.0.1' }) {
  const realRoot = fs.realpathSync(root)
  const index = path.join(realRoot, 'index.html')
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(request, response, apiPort)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' })
      return response.end()
    }
    const file = resolveFile(realRoot, url.pathname)
    if (file) return sendFile(response, file, request.method)
    // Fichier statique manquant (extension) : 404 ; sinon route de l'application → index.html.
    if (path.extname(url.pathname)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      return response.end('Introuvable')
    }
    return sendFile(response, index, request.method)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      const address = server.address()
      resolve({ server, url: `http://${host}:${typeof address === 'object' && address ? address.port : port}` })
    })
  })
}

module.exports = { startUiServer, resolveFile }
