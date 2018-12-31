import test from 'ava'
import dedent from 'dedent'
import { writeFile, mkdirs } from 'fs-extra'
import { dirname as getDirnameOf } from 'path'
import { getKubernetesConfig } from '../index'
import useFakeFileSystem from 'mock-fs'

const certFilePath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
const tokenFilePath = '/var/run/secrets/kubernetes.io/serviceaccount/token'

const configPath = `${process.env.HOME}/.kube/config`

const writeKubectlConfig = async (configString: string) => {
  await mkdirs(getDirnameOf(configPath))
  await writeFile(configPath, configString)
}

test.beforeEach(async () => useFakeFileSystem())
test.afterEach(() => useFakeFileSystem.restore())

test('loads config from environment when inside cluster', async t => {
  process.env.KUBERNETES_SERVICE_HOST = 'foo'
  process.env.KUBERNETES_PORT_443_TCP_PORT = '5000'

  await mkdirs(getDirnameOf(certFilePath))
  await writeFile(certFilePath, 'test-cert')

  await mkdirs(getDirnameOf(tokenFilePath))
  await writeFile(tokenFilePath, 'test-token')

  const config = await getKubernetesConfig()
  t.is(config.baseURL, 'https://foo:5000')
  t.is(config.httpsAgent.options.ca, 'test-cert')
  t.is(
    config.headers && config.headers.authorization,
    'Bearer test-token'
  )

  delete process.env.KUBERNETES_SERVICE_HOST
  delete process.env.KUBERNETES_PORT_443_TCP_PORT
})

test('load config from kubectl config when outside cluster', async t => {
  await writeKubectlConfig(dedent`
    current-context: foo
    contexts:
    - name: foo
      context:
        cluster: foo-cluster
        user: foo-user
    clusters:
    - name: foo-cluster
      cluster:
        server: https://foo
    users:
    - name: foo-user
      user:
        name: bob
        client-key-data: test-key
        client-certificate-data: test-cert
  `)
  const config = await getKubernetesConfig()
  t.is(config.baseURL, 'https://foo')
  t.falsy(config.httpsAgent.options.rejectUnauthorized)
  t.is(config.httpsAgent.options.key, 'test-key')
  t.is(config.httpsAgent.options.cert, 'test-cert')
})
