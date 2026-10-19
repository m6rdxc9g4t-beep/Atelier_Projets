// Protection de l'API locale contre les sites web visités dans le navigateur :
// - « DNS rebinding » : un domaine externe qui pointe soudain vers 127.0.0.1 envoie un en-tête Host étranger ;
// - requêtes d'un autre site (CSRF) : l'en-tête Origin d'une écriture désigne alors un hôte étranger.
// Seuls les hôtes locaux (et ceux de ALLOWED_HOSTS) sont acceptés. Les outils sans navigateur (curl du hook
// post-commit, scripts) n'envoient pas d'Origin et restent acceptés.
// Routes de la Suite Atelier (import Atelier Tab) : l'origine « null » de l'app Electron d'Atelier Tab est
// aussi acceptée (option allowNullOrigin) ; l'en-tête Host reste contrôlé.
import type { FastifyRequest } from 'fastify'
import { HttpError } from './errors.ts'

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1']
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Nom d'hôte d'un en-tête Host (« 127.0.0.1:3000 », « [::1]:3000 ») ou d'une URL, en minuscules et sans port. */
export function hostName(value: string): string {
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']') === -1 ? undefined : host.indexOf(']'))
  const colon = host.lastIndexOf(':')
  return colon === -1 || host.indexOf(':') !== colon ? host : host.slice(0, colon)
}

/** Hôtes acceptés : les hôtes locaux, l'hôte d'écoute s'il est nommé, et la liste fournie. */
export function allowedHosts(listenHost: string | undefined, extra: readonly string[] = []): Set<string> {
  const hosts = new Set(LOCAL_HOSTS)
  if (listenHost && listenHost !== '0.0.0.0' && listenHost !== '::') hosts.add(hostName(listenHost))
  for (const host of extra) if (host.trim() !== '') hosts.add(hostName(host))
  return hosts
}

export interface LocalOnlyOptions {
  /** Routes qui acceptent aussi l'origine « null » (application de bureau, fichier local). */
  allowNullOrigin?: (request: FastifyRequest) => boolean
}

export function createLocalOnlyGuard(hosts: ReadonlySet<string>, options: LocalOnlyOptions = {}) {
  return async (request: FastifyRequest): Promise<void> => {
    const host = request.headers.host
    if (!host || !hosts.has(hostName(host))) {
      throw new HttpError(403, 'FORBIDDEN_HOST', `Hôte « ${host ?? ''} » refusé : l’API n’accepte que les requêtes locales (voir ALLOWED_HOSTS)`)
    }
    const origin = request.headers.origin
    if (origin !== undefined && UNSAFE_METHODS.has(request.method)) {
      if (origin === 'null' && options.allowNullOrigin?.(request)) return
      let originHost: string | null = null
      try {
        originHost = new URL(origin).hostname
      } catch {
        originHost = null
      }
      if (originHost === null || !hosts.has(hostName(originHost))) {
        throw new HttpError(403, 'FORBIDDEN_ORIGIN', `Origine « ${origin} » refusée : seule l’interface locale peut modifier les données`)
      }
    }
  }
}
