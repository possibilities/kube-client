import dedent from 'dedent'
import test from 'ava'
import {
  getKubernetesClient,
  getKubernetesConfigOutsideCluster
} from '../index'
import { KubernetesClientInstance } from '../types'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const createTestPod = (
  kubernetes: KubernetesClientInstance
) => kubernetes.post(
  '/api/v1/namespaces/default/pods',
  {
    metadata: { name: 'hello-1', labels: { role: 'test' } },
    spec: {
      restartPolicy: 'Never',
      containers: [{
        name: 'hello',
        image: 'ubuntu',
        command: ['sh'],
        args: ['-C', '/scripts/run.sh'],
        volumeMounts: [{ mountPath: '/scripts', name: 'scripts' }]
      }],
      volumes: [
        {
          name: 'scripts',
          configMap: { defaultMode: 484, name: 'run-script' }
        }
      ]
    }
  }
)

const waitForDeletion = async (
  kubernetes: KubernetesClientInstance,
  resourceUrl: string,
  clientConfig?: any
) => {
  while (true) {
    const resources = await kubernetes.get(
      resourceUrl,
      clientConfig
    ).catch(() => undefined)
    if (!resources || !resources.length) {
      break
    }
  }
}

const waitForPodComplete = async (
  kubernetes: KubernetesClientInstance,
  podUrl: string
) => {
  while (true) {
    const pod = await kubernetes.get(podUrl).catch(() => undefined)
    if (
      !pod ||
      ['Succeeded', 'Failed']
        .includes(pod && pod.status && pod.status.phase)
    ) {
      break
    }
  }
}

test.beforeEach(async t => {
  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)

  await kubernetes.delete(
    '/api/v1/namespaces/default/configmaps',
    { params: { labelSelector: 'role=test' } }
  )

  await waitForDeletion(
    kubernetes,
    '/api/v1/namespaces/default/configmaps',
    { params: { labelSelector: 'role=test' } }
  )

  await kubernetes.delete(
    '/api/v1/namespaces/default/pods',
    { params: { labelSelector: 'role=test' } }
  )

  await waitForDeletion(
    kubernetes,
    '/api/v1/namespaces/default/pods',
    { params: { labelSelector: 'role=test' } }
  )
})

test('supports common methods', async t => {
  t.plan(5)

  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)
  await kubernetes.post(
    '/api/v1/namespaces/default/configmaps',
    {
      data: { a: 'a', b: 'b', c: 'c' },
      metadata: { name: 'config-1', labels: { role: 'test' } }
    }
  )
  await kubernetes.post(
    '/api/v1/namespaces/default/configmaps',
    {
      data: { a: 'a', b: 'b', c: 'c' },
      metadata: { name: 'config-2', labels: { role: 'test' } }
    }
  )

  const configMaps = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps',
    { params: { labelSelector: 'role=test' } }
  )

  const configNames = configMaps.map((config: any) => config.metadata.name)
  t.deepEqual(configNames, ['config-1', 'config-2'])

  const configMap = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps/config-2'
  )
  t.is(configMap.metadata.name, 'config-2')

  await kubernetes.patch(
    '/api/v1/namespaces/default/configmaps/config-2',
    { data: { b: 'z' } }
  )

  const configMapAfterPatch = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps/config-2'
  )
  t.is(configMapAfterPatch.data.b, 'z')

  await kubernetes.put(
    '/api/v1/namespaces/default/configmaps/config-2',
    {
      data: { foo: 'bar' },
      metadata: { name: 'config-2', labels: { role: 'test' } }
    }
  )

  const configMapBeforeDelete = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps/config-2'
  ).catch(() => undefined)
  await kubernetes.delete('/api/v1/namespaces/default/configmaps/config-2')
  const configMapAfterDelete = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps/config-2'
  ).catch(() => undefined)

  t.truthy(configMapBeforeDelete)
  t.falsy(configMapAfterDelete)
})

test('supports upsert method', async t => {
  t.plan(3)

  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)

  // Check that the config doesn't exist first
  const configMap = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps/config-1'
  ).catch(() => undefined)
  t.falsy(configMap)

  await kubernetes.upsert(
    '/api/v1/namespaces/default/configmaps',
    {
      data: { foo: 'bar' },
      metadata: { name: 'config-1', labels: { role: 'test' } }
    }
  )

  const configMapAfterFirstUpsert = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps/config-1'
  )
  t.is(configMapAfterFirstUpsert.data.foo, 'bar')

  await kubernetes.upsert(
    '/api/v1/namespaces/default/configmaps',
    {
      data: { foo: 'baz' },
      metadata: { name: 'config-1', labels: { role: 'test' } }
    }
  )

  const configMapAfterSecondUpsert = await kubernetes.get(
    '/api/v1/namespaces/default/configmaps/config-1'
  )
  t.is(configMapAfterSecondUpsert.data.foo, 'baz')
})

test('fetches logs', async t => {
  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)

  const runScript = dedent`
    #!/bin/sh
    echo hi 1
    echo hi 2
    exit 0
  `

  await kubernetes.post(
    '/api/v1/namespaces/default/configmaps',
    {
      metadata: { name: 'run-script', labels: { role: 'test' } },
      data: { 'run.sh': runScript }
    }
  )

  await createTestPod(kubernetes)

  await waitForPodComplete(
    kubernetes,
    '/api/v1/namespaces/default/pods/hello-1'
  )

  const log = await kubernetes.get(
    '/api/v1/namespaces/default/pods/hello-1/log'
  )

  t.is(
    log.trim(),
    dedent`
      hi 1
      hi 2
    `
  )
})

test('watches resources', async t => {
  t.plan(2)
  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)

  const watchConfigs = await kubernetes.watch(
    '/api/v1/watch/namespaces/default/configmaps',
    { params: { labelSelector: 'role=test' } }
  )

  // Cause assertions as items are added/deleted
  watchConfigs.on('added', configmap => t.pass())
  watchConfigs.on('deleted', configmap => t.pass())

  // Add and delete an item to cause some assertions
  await kubernetes.post(
    '/api/v1/namespaces/default/configmaps',
    { metadata: { name: 'config-1', labels: { role: 'test' } } }
  )
  await kubernetes.delete(
    '/api/v1/namespaces/default/configmaps/config-1'
  )

  await waitForDeletion(
    kubernetes,
    '/api/v1/namespaces/default/configmaps/config-1'
  )

  watchConfigs.unwatch()
})

test('streams resources', async t => {
  t.plan(1)

  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)

  const streamConfigs = await kubernetes.stream(
    '/api/v1/watch/namespaces/default/configmaps',
    { params: { labelSelector: 'role=test' } }
  )

  streamConfigs.on('data', data => {
    t.is(JSON.parse(data.toString()).object.metadata.name, 'config-1')
  })

  // Add and delete an item to cause some assertions
  await kubernetes.post(
    '/api/v1/namespaces/default/configmaps',
    { metadata: { name: 'config-1', labels: { role: 'test' } } }
  )

  await waitForPodComplete(
    kubernetes,
    '/api/v1/namespaces/default/pods/hello-1'
  )

  streamConfigs.destroy()
})

test('watches logs', async t => {
  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)

  const runScript = dedent`
    #!/bin/bash
    sleep 1
    echo hi 1
    sleep 1
    echo hi 2
    exit 0
  `

  await kubernetes.post(
    '/api/v1/namespaces/default/configmaps',
    {
      metadata: { name: 'run-script', labels: { role: 'test' } },
      data: { 'run.sh': runScript }
    }
  )

  await createTestPod(kubernetes)

  await waitForPodComplete(
    kubernetes,
    '/api/v1/namespaces/default/pods/hello-1'
  )

  const logs = await kubernetes.watch(
    '/api/v1/namespaces/default/pods/hello-1/log',
    { params: { follow: 1 } }
  )

  let logLines: string[] = []
  logs.on('line', (line: string) => {
    logLines = [...logLines, line]
  })

  await waitForPodComplete(
    kubernetes,
    '/api/v1/namespaces/default/pods/hello-1'
  )

  // Log can take some ms to flush completely
  await sleep(100)

  t.deepEqual(logLines, [
    'hi 1',
    'hi 2',
    ''
  ])

  logs.unwatch()
})

test('waits for condition', async t => {
  const config = await getKubernetesConfigOutsideCluster('minikube')
  const kubernetes = await getKubernetesClient(config)

  const runScript = dedent`
    #!/bin/bash
    sleep 1
    echo hi 1
    sleep 1
    echo hi 2
    exit 0
  `

  await kubernetes.post(
    '/api/v1/namespaces/default/configmaps',
    {
      metadata: { name: 'run-script', labels: { role: 'test' } },
      data: { 'run.sh': runScript }
    }
  )

  await createTestPod(kubernetes)

  const onComplete = (pod: any) =>
    ['Failed', 'Succeeded'].includes(pod.status.phase)
  await kubernetes.waitFor(
    onComplete,
    '/api/v1/watch/namespaces/default/pods/hello-1'
  )

  t.pass()
})
