import { getKubernetesConfig } from './index'
import { EventEmitter } from 'events'
import axios, { AxiosResponse, AxiosRequestConfig } from 'axios'
import eventStream from 'event-stream'
import { IncomingMessage } from 'http'

import { ResourceWatcher, KubernetesClientInstance } from './types'

const extractData = (response: AxiosResponse): any => response.data
const extractItems = (response: any): any => response.items || response

const getStream = async (
  get: any,
  url: string,
  config: AxiosRequestConfig = {}
): Promise<IncomingMessage> => {
  const requestConfig = {
    ...config,
    responseType: 'stream',
    params: Object.assign(
      {},
      config.params,
      url.endsWith('/log')
        ? { follow: 1 }
        : { watch: 1 }
    )
  }
  const response = await get(url, requestConfig)
  return response.data
}

const prepareWatch = (get: any) =>
  async (
    url: string,
    config: AxiosRequestConfig = {}
  ): Promise<ResourceWatcher> => {
    const vent = new EventEmitter()
    const stream = await getStream(get, url, config)

    const unwatch = () => {
      vent.removeAllListeners()
      stream.destroy()
    }

    stream
      .pipe(eventStream.split())
      .pipe(eventStream.parse())
      .pipe(eventStream.mapSync((data: any) => vent.emit(
        data.type.toLowerCase(),
        data.object
      )))

    return Object.assign(vent, { unwatch, stream })
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
  return {
    get: prepareResponse(api.get),
    delete: prepareResponse(api.delete),
    head: prepareResponse(api.head),
    post: prepareResponse(api.post),
    put: prepareResponse(api.put),
    patch: prepareResponse(api.patch),
    watch: prepareWatch(api.get),
    stream: (url, config) => getStream(api.get, url, config)
  }
}

export default getKubernetesClient
