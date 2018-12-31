import https from 'https'
import getKubectlConfig from './getKubectlConfig'
import { AxiosRequestConfig } from 'axios'
import { KubectlConfig } from './types'

const getAccessToken = (config: KubectlConfig): string => (
  config.user &&
  config.user['auth-provider'] &&
  config.user['auth-provider']['access-token']
)

const getAgentOptions = (config: KubectlConfig) => {
  if (
    config.user &&
    config.user['client-key-data'] &&
    config.user['client-certificate-data']
  ) {
    return {
      rejectUnauthorized: false,
      key: config.user['client-key-data'],
      cert: config.user['client-certificate-data']
    }
  }

  return { rejectUnauthorized: false }
}

const getKubernetesClientConfigOutsideCluster = async (
  contextName?: string
): Promise<AxiosRequestConfig> => {
  const config = await getKubectlConfig(contextName)
  const agentOptions = getAgentOptions(config)
  const httpsAgent = new https.Agent(agentOptions)
  const accessToken = getAccessToken(config)

  if (accessToken) {
    return {
      httpsAgent,
      baseURL: config.cluster.server,
      headers: { authorization: `Bearer ${accessToken}` }
    }
  }

  return {
    httpsAgent,
    baseURL: config.cluster.server
  }

}

export default getKubernetesClientConfigOutsideCluster
