import test from 'ava'
import { writeFile, mkdirs, remove } from 'fs-extra'
import { dirname as getDirnameOf } from 'path'
import { getKubernetesConfigInsideCluster } from '../index'
import useFakeFileSystem from 'mock-fs'

const certFilePath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
const tokenFilePath = '/var/run/secrets/kubernetes.io/serviceaccount/token'

test.beforeEach(async () => {
  useFakeFileSystem()

  process.env.KUBERNETES_SERVICE_HOST = 'foo'
  process.env.KUBERNETES_PORT_443_TCP_PORT = '5000'

  await mkdirs(getDirnameOf(certFilePath))
  await writeFile(certFilePath, 'test-cert')

  await mkdirs(getDirnameOf(tokenFilePath))
  await writeFile(tokenFilePath, 'test-token')
})

test.afterEach(() => {
  useFakeFileSystem.restore()

  delete process.env.KUBERNETES_SERVICE_HOST
  delete process.env.KUBERNETES_PORT_443_TCP_PORT
})

test('loads config from environment', async t => {
  const config = await getKubernetesConfigInsideCluster()
  t.is(config.baseURL, 'https://foo:5000')
  t.is(config.httpsAgent.options.ca, 'test-cert')
  t.is(
    config.headers && config.headers.authorization,
    'Bearer test-token'
  )
})

test('errors when api port env var is unavailable', async t => {
  delete process.env.KUBERNETES_PORT_443_TCP_PORT
  try {
    await getKubernetesConfigInsideCluster()
    t.fail()
  } catch (error) {
    t.is(error.message, 'cannot get kubernetes client config without `KUBERNETES_PORT_443_TCP_PORT` env var')
  }
})

test('errors when port host env var is unavailable', async t => {
  delete process.env.KUBERNETES_SERVICE_HOST
  try {
    await getKubernetesConfigInsideCluster()
    t.fail()
  } catch (error) {
    t.is(error.message, 'cannot get kubernetes client config without `KUBERNETES_SERVICE_HOST` env var')
  }
})

test('errors when cert file is unavailable', async t => {
  try {
    await remove(certFilePath)
    await getKubernetesConfigInsideCluster()
    t.fail()
  } catch (error) {
    t.is(error.message, 'cannot get kubernetes client config without cert file')
  }
})

test('errors when token file is unavailable', async t => {
  await remove(tokenFilePath)
  try {
    await getKubernetesConfigInsideCluster()
    t.fail()
  } catch (error) {
    t.is(error.message, 'cannot get kubernetes client config without token file')
  }
})
