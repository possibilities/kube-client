import { join as joinPath } from 'path'
import { execSync } from 'child_process'
import { pathExists, readFile } from 'fs-extra'
import { safeLoad as readYaml } from 'js-yaml'
import jsonPath from 'jsonpath'

import {
  User,
  Config,
  Cluster,
  Context,
  KubectlUser,
  KubectlConfig,
  KubectlCluster
} from './types'

const decode = (encoded: string): string =>
  Buffer.from(encoded, 'base64').toString()

const encode = (decoded: string): string =>
  Buffer.from(decoded).toString('base64')

const isBase64 = (maybeEncoded: string): boolean => {
  try {
    return encode(decode(maybeEncoded)) === maybeEncoded
  } catch (error) {
    return false
  }
}

const ensureDecoded = (maybeEncoded: string): string =>
  isBase64(maybeEncoded) ? decode(maybeEncoded) : maybeEncoded

const getJsonPath = (json: string, rawPath: string): string => {
  const path = '$' + rawPath.slice(1, -1)
  return jsonPath.value(json, path)
}

const resolveResourceKey = async (
  resource: { [key: string ]: string },
  name: string
): Promise<string | undefined> => {
  if (resource[`${name}-data`]) return resource[`${name}-data`]
  const path = resource[name]
  if (await pathExists(path)) {
    return readFile(path, 'utf8')
  }
  return undefined
}

const resolveAuthProvider = async (user: KubectlUser) => {
  if (user['auth-provider'] && user['auth-provider'].config) {
    const { config } = user['auth-provider']

    // If we have an unexpired access token we can return the auth provider
    // as-is
    if (config['access-token']) {
      if (config.expiry) {
        const expiry = new Date(config.expiry)
        const isExpired = expiry < new Date()
        if (!isExpired) {
          return user['auth-provider']
        }
      }
    }

    // If we have access to a token creating command we can invoke it
    if (
      config['cmd-path'] &&
      config['cmd-args'] &&
      config['expiry-key'] &&
      config['token-key']
    ) {
      const command = `${config['cmd-path']} ${config['cmd-args']}`
      const providerPayloadJson = execSync(command).toString()
      const providerPayload = JSON.parse(providerPayloadJson)
      const expiryKey = config['expiry-key']
      const tokenKey = config['token-key']
      const expiry = getJsonPath(providerPayload, expiryKey)
      const token = getJsonPath(providerPayload, tokenKey)
      return {
        ...user['auth-provider'],
        config: { ...config, expiry, 'access-token': token }
      }
    }

    return undefined
  }

  return user['auth-provider']
}

const clusterView = async (cluster: Cluster): Promise<KubectlCluster> => {
  const certificateAuthorityData =
    await resolveResourceKey(cluster.cluster, 'certificate-authority')
  if (!certificateAuthorityData) return cluster.cluster
  return {
    ...cluster.cluster,
    'certificate-authority-data': certificateAuthorityData
  }
}

const userView = async (user: User): Promise<KubectlUser> => {
  let userView = { ...user.user }

  const clientCertificateData =
    await resolveResourceKey(userView, 'client-certificate')
  if (clientCertificateData) {
    userView = {
      ...userView,
      'client-certificate-data': ensureDecoded(clientCertificateData)
    }
  }

  const clientKeyData = await resolveResourceKey(userView, 'client-key')
  if (clientKeyData) {
    userView = {
      ...userView,
      'client-key-data': ensureDecoded(clientKeyData)
    }
  }

  const authProvider = await resolveAuthProvider(userView)
  if (authProvider) {
    userView = { ...userView, 'auth-provider': authProvider }
  }

  return userView
}

const loadRawConfig = async (): Promise<Config> => {
  const homePath = process.env.HOME
  if (!homePath) throw new Error('kubectl could not find home path')

  const kubeConfigPath = joinPath(homePath, '.kube', 'config')
  if (!await pathExists(kubeConfigPath)) {
    throw new Error(`kubectl config could not be found: ${kubeConfigPath}`)
  }

  const kubeConfigString = await readFile(kubeConfigPath, 'utf8')

  try {
    return readYaml(kubeConfigString)
  } catch (error) {
    throw new Error(`kubectl config could not be parsed: ${kubeConfigPath}`)
  }
}

const getKubectlConfig = async (
  contextName?: string
): Promise<KubectlConfig> => {
  const config = await loadRawConfig()

  const currentContextName = contextName || config['current-context']
  if (!currentContextName) {
    throw new Error('kubectl `current-context` key could not be found')
  }

  if (!config.contexts) {
    throw new Error('kubectl `contexts` key could not be found')
  }
  const context = config.contexts
    .find((context: Context) => context.name === currentContextName)
  if (!context) {
    throw new Error(
      `kubectl \`context\` could not be found by key: ${currentContextName}`
    )
  }

  if (!config.clusters) {
    throw new Error('kubectl `clusters` key could not be found')
  }
  const cluster = config.clusters
    .find((cluster: Cluster) => cluster.name === context.context.cluster)
  if (!cluster) {
    throw new Error(
      `kubectl \`cluster\` could not be found by key: ${currentContextName}`
    )
  }

  if (!config.users) {
    throw new Error('kubectl `users` key could not be found')
  }
  const user = config.users
    .find((user: User) => user.name === context.context.user)
  if (!user) {
    throw new Error(
      `kubectl \`user\` could not be found by key: ${currentContextName}`
    )
  }

  return {
    user: await userView(user),
    cluster: await clusterView(cluster)
  }
}

export default getKubectlConfig
