import test from 'ava'
import dedent from 'dedent'
import { getKubectlConfig } from '../index'
import useFakeFileSystem from 'mock-fs'
import { writeFile, mkdirs } from 'fs-extra'
import { dirname as getDirnameOf } from 'path'

const encode = (decoded: string): string =>
  Buffer.from(decoded).toString('base64')

const configPath = `${process.env.HOME}/.kube/config`
const fakeFilePath = `/tmp/.kubectl-test-fake`

test.beforeEach(() => useFakeFileSystem())
test.afterEach(() => useFakeFileSystem.restore())

const writeKubectlConfig = async (configString: string) => {
  await mkdirs(getDirnameOf(configPath))
  await writeFile(configPath, configString)
}

test('returns current context', async t => {
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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
  `)
  const config = await getKubectlConfig()

  t.deepEqual(config, {
    name: 'foo',
    user: { name: 'bob' },
    cluster: { server: 'foo-server' }
  })
})

test('returns specified context', async t => {
  // This config has a second user/cluster named bar
  await writeKubectlConfig(dedent`
    current-context: foo
    contexts:
    - name: foo
      context:
        cluster: foo-cluster
        user: foo-user
    - name: bar
      context:
        cluster: bar-cluster
        user: bar-user
    clusters:
    - name: foo-cluster
      cluster:
        server: foo-server
    - name: bar-cluster
      cluster:
        server: bar-server
    users:
    - name: foo-user
      user:
        name: bob
    - name: bar-user
      user:
        name: mike
  `)
  const config = await getKubectlConfig('bar')

  t.deepEqual(config, {
    name: 'bar',
    user: { name: 'mike' },
    cluster: { server: 'bar-server' }
  })
})

test('resolves cluster certificate-authority', async t => {
  const fakeContent = 'certificate authority content'

  await mkdirs(getDirnameOf(fakeFilePath))
  await writeFile(fakeFilePath, fakeContent)

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
        server: foo-server
        certificate-authority: ${fakeFilePath}
    users:
    - name: foo-user
      user:
        name: bob
  `)

  const config = await getKubectlConfig()
  t.is(config.cluster['certificate-authority-data'], fakeContent)
})

test('resolves user client-certificate', async t => {
  const fakeContent = 'client certificate content'

  await mkdirs(getDirnameOf(fakeFilePath))
  await writeFile(fakeFilePath, fakeContent)

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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
        client-certificate: ${fakeFilePath}
  `)

  const config = await getKubectlConfig()
  t.is(config.user['client-certificate-data'], fakeContent)
})

test('resolves user client-key', async t => {
  const fakeContent = 'client key content'

  await mkdirs(getDirnameOf(fakeFilePath))
  await writeFile(fakeFilePath, fakeContent)

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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
        client-key: ${fakeFilePath}
  `)

  const config = await getKubectlConfig()
  t.is(config.user['client-key-data'], fakeContent)
})

test('resolves access-token when unexpired', async t => {
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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
        auth-provider:
          config:
            access-token: unexpired-token
            expiry: 9000-08-27T04:32:36Z
  `)

  const config = await getKubectlConfig()

  const accessToken =
    config.user['auth-provider'] &&
    config.user['auth-provider'].config &&
    config.user['auth-provider'].config['access-token']

  t.is(accessToken, 'unexpired-token')
})

test('generates access-token when expired', async t => {
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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
        auth-provider:
          config:
            access-token: expired-token
            expiry: 2000-08-27T04:32:36Z
            cmd-path: node
            cmd-args: |
              -e "console.log(\
                JSON.stringify({\
                  foo: {
                    token: 'generated-token',\
                    expiry: '9000-08-27T04:32:36Z'\
                  }
                })\
              )"
            expiry-key: '{.foo.expiry}'
            token-key: '{.foo.token}'
  `)

  const config = await getKubectlConfig()

  const accessToken =
    config.user['auth-provider'] &&
    config.user['auth-provider'].config &&
    config.user['auth-provider'].config['access-token']

  t.is(accessToken, 'generated-token')
})

test('generates access-token when not present', async t => {
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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
        auth-provider:
          config:
            cmd-path: node
            cmd-args: |
              -e "console.log(\
                JSON.stringify({\
                  foo: {
                    token: 'generated-token',\
                    expiry: '9000-08-27T04:32:36Z'\
                  }
                })\
              )"
            expiry-key: '{.foo.expiry}'
            token-key: '{.foo.token}'
  `)

  const config = await getKubectlConfig()

  const accessToken =
    config.user['auth-provider'] &&
    config.user['auth-provider'].config &&
    config.user['auth-provider'].config['access-token']

  t.is(accessToken, 'generated-token')
})

test('decodes user client-certificate-data', async t => {
  const fakeContent = 'client certificate content data'

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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
        client-certificate-data: ${encode(fakeContent)}
  `)

  const config = await getKubectlConfig()
  t.is(config.user['client-certificate-data'], fakeContent)
})

test('decodes user client-key-data', async t => {
  const fakeContent = 'client key content data'

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
        server: foo-server
    users:
    - name: foo-user
      user:
        name: bob
        client-key-data: ${encode(fakeContent)}
  `)

  const config = await getKubectlConfig()
  t.is(config.user['client-key-data'], fakeContent)
})

test('errors when config file missing', async t => {
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, `kubectl config could not be found: ${configPath}`)
  }
})

test('errors when config file invalid', async t => {
  await writeKubectlConfig(']')
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, `kubectl config could not be parsed: ${configPath}`)
  }
})

test('errors when `current-context` is missing', async t => {
  await writeKubectlConfig('{}')
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, 'kubectl `current-context` key could not be found')
  }
})

test('errors when `contexts` is missing', async t => {
  await writeKubectlConfig(dedent`
    current-context: foo
  `)
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, 'kubectl `contexts` key could not be found')
  }
})

test('errors when current context is missing', async t => {
  await writeKubectlConfig(dedent`
    current-context: foo
    contexts: []
  `)
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, 'kubectl `context` could not be found by key: foo')
  }
})

test('errors when `clusters` is missing', async t => {
  await writeKubectlConfig(dedent`
    current-context: foo
    contexts:
    - name: foo
  `)
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, 'kubectl `clusters` key could not be found')
  }
})

test('errors when current cluster is missing', async t => {
  await writeKubectlConfig(dedent`
    current-context: foo
    contexts:
    - name: foo
    clusters: []
  `)
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, 'kubectl `cluster` could not be found by key: foo')
  }
})

test('errors when `users` is missing', async t => {
  await writeKubectlConfig(dedent`
    current-context: foo
    contexts:
    - name: foo
      context:
        cluster: foo-cluster
        user: foo-user
    clusters:
    - name: foo-cluster
  `)
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, 'kubectl `users` key could not be found')
  }
})

test('errors when current user is missing', async t => {
  await writeKubectlConfig(dedent`
    current-context: foo
    contexts:
    - name: foo
      context:
        cluster: foo-cluster
        user: foo-user
    clusters:
    - name: foo-cluster
    users: []
  `)
  try {
    await getKubectlConfig()
    t.fail()
  } catch (error) {
    t.is(error.message, 'kubectl `user` could not be found by key: foo')
  }
})
