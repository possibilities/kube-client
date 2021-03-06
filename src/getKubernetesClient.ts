import getKubernetesConfig from './getKubernetesConfig'
import { EventEmitter } from 'events'
import axios, { AxiosResponse, AxiosRequestConfig } from 'axios'
import eventStream from 'event-stream'
import { IncomingMessage } from 'http'

import { ResourceWatcher, KubernetesClientInstance, Predicate, EventType } from './types'

const extractData = (response: AxiosResponse): any => response.data
const extractItems = (response: any): any => response.items || response

const getStream = async (
  get: any,
  url: string,
  config: AxiosRequestConfig = {}
): Promise<IncomingMessage> => {
  const requestConfig = { ...config, responseType: 'stream' }
  const response = await get(url, requestConfig)
  return response.data
}

const pipeTextStreamToVent = (
  stream: IncomingMessage,
  vent: EventEmitter
) => {
  stream
    .pipe(eventStream.split())
    .pipe(eventStream.mapSync((line: any) => vent.emit(
      'line',
      line
    )))
}

const pipeJsonStreamToVent = (
  stream: IncomingMessage,
  vent: EventEmitter
) => {
  stream
    .pipe(eventStream.split())
    .pipe(eventStream.parse())
    .pipe(eventStream.mapSync((data: any) => vent.emit(
      data.type.toLowerCase(),
      data.object
    )))
}

const prepareWatch = (get: any) =>
  async (
    url: string,
    config: AxiosRequestConfig = {}
  ): Promise<ResourceWatcher> => {
    const isLogUrl = url.endsWith('/log')

    const stream = await getStream(get, url, config)

    const vent = new EventEmitter()
    isLogUrl
      ? pipeTextStreamToVent(stream, vent)
      : pipeJsonStreamToVent(stream, vent)

    const unwatch = () => {
      vent.removeAllListeners()
      stream.destroy()
    }

    return Object.assign(vent, { unwatch, stream })
  }

const prepareWaitFor = (
  get: any
) => (
  predicate: Predicate,
  url: string,
  config: any
) => new Promise(async (resolve, reject) => {
  const watch = prepareWatch(get)
  const watchResources = await watch(url, config).catch(reject)
  // Local helper for release resources and resolve promise
  const cleanup = (resource?: any) => {
    watchResources && watchResources.unwatch()
    resolve(resource)
  }
  if (!watchResources) return cleanup()
  // Any time a resource changes we check the predicate and then cleanup
  // as soon as it passes
  const onResourceChange = (eventType: EventType) => (resource: any) => {
    if (predicate(resource, eventType)) cleanup(resource)
  }
  watchResources.on('added', onResourceChange('added'))
  watchResources.on('modified', onResourceChange('modified'))
  watchResources.on('deleted', onResourceChange('deleted'))
})

const prepareUpsert = (post: any, patch: any) =>
  async (
    url: string,
    resource: any,
    config: AxiosRequestConfig = {}
  ): Promise<ResourceWatcher> => {
    try {
      return await post(url, resource)
    } catch (error) {
      if (error.response.status === 409) {
        return patch(
          `${url}/${resource.metadata.name}`,
          resource
        )
      }
      throw error
    }
  }

const prepareResponse = (handler: any) => async (...args: any[]) =>
  extractItems(extractData(await handler(...args)))

const injectPatchHeader = (
  config: AxiosRequestConfig
): AxiosRequestConfig =>
  config.method && config.method.toLowerCase() !== 'patch'
    ? config
    : {
      ...config,
      headers: Object.assign(
        config.headers || {},
        { 'content-type': 'application/merge-patch+json' }
      )
    }

const getKubernetesClient = async (
  config?: AxiosRequestConfig
): Promise<KubernetesClientInstance> => {
  const apiConfig = config ||
    await getKubernetesConfig().catch(() => undefined)
  if (!apiConfig) throw new Error('kubernetes config could not be found')

  const api = axios.create(apiConfig)
  api.interceptors.request.use(injectPatchHeader)

  const post = prepareResponse(api.post)
  const patch = prepareResponse(api.patch)

  return {
    post,
    patch,
    get: prepareResponse(api.get),
    delete: prepareResponse(api.delete),
    head: prepareResponse(api.head),
    put: prepareResponse(api.put),
    watch: prepareWatch(api.get),
    waitFor: prepareWaitFor(api.get),
    stream: (url, config) => getStream(api.get, url, config),
    upsert: prepareUpsert(post, patch)
  }
}

export default getKubernetesClient
