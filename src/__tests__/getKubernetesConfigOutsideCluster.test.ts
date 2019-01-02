import dedent from 'dedent'
import test from 'ava'
import useFakeFileSystem from 'mock-fs'
import { writeFile, mkdirs } from 'fs-extra'
import { dirname as getDirnameOf } from 'path'
import { getKubernetesConfigOutsideCluster } from '../index'

const configPath = `${process.env.HOME}/.kube/config`

const writeKubectlConfig = async (configString: string) => {
  await mkdirs(getDirnameOf(configPath))
  await writeFile(configPath, configString)
}

test.beforeEach(() => useFakeFileSystem())
test.afterEach(() => useFakeFileSystem.restore())

test('loads config with cert', async t => {
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
  const config = await getKubernetesConfigOutsideCluster()
  t.is(config.baseURL, 'https://foo')
  t.falsy(config.httpsAgent.options.rejectUnauthorized)
  t.is(config.httpsAgent.options.key, 'test-key')
  t.is(config.httpsAgent.options.cert, 'test-cert')
})

test('loads config without cert', async t => {
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
  `)
  const config = await getKubernetesConfigOutsideCluster()
  t.is(config.httpsAgent.options.key, undefined)
  t.is(config.httpsAgent.options.cert, undefined)
})

test('loads config with access token', async t => {
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
        auth-provider:
          access-token: test-access-token
  `)
  const config = await getKubernetesConfigOutsideCluster()
  t.is(
    config.headers && config.headers.authorization,
    'Bearer test-access-token'
  )
})

test('loads config without access token', async t => {
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
  const config = await getKubernetesConfigOutsideCluster()
  t.falsy(config.headers && config.headers.authorization)
})
