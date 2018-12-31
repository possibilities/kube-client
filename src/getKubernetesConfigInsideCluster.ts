import https from 'https'
import { readFile, pathExists } from 'fs-extra'
import { AxiosRequestConfig } from 'axios'

const getKubernetesClientConfigInsideCluster = async (): Promise<AxiosRequestConfig> => {
  const kubernetesServiceHost = process.env.KUBERNETES_SERVICE_HOST
  if (!kubernetesServiceHost) {
    throw new Error('cannot get kubernetes client config without `KUBERNETES_SERVICE_HOST` env var')
  }

  const kubernetesServicePort = process.env.KUBERNETES_PORT_443_TCP_PORT
  if (!kubernetesServicePort) {
    throw new Error('cannot get kubernetes client config without `KUBERNETES_PORT_443_TCP_PORT` env var')
  }

  const caPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
  if (!await pathExists(caPath)) {
    throw new Error('cannot get kubernetes client config without cert file')
  }

  const tokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token'
  if (!await pathExists(tokenPath)) {
    throw new Error('cannot get kubernetes client config without token file')
  }

  const httpsAgent = new https.Agent({ ca: await readFile(caPath, 'utf8') })
  return {
    httpsAgent,
    baseURL: `https://${kubernetesServiceHost}:${kubernetesServicePort}`,
    headers: { authorization: `Bearer ${await readFile(tokenPath, 'utf8')}` }
  }
}

export default getKubernetesClientConfigInsideCluster
