import getKubernetesConfigInsideCluster
  from './getKubernetesConfigInsideCluster'
import getKubernetesConfigOutsideCluster
  from './getKubernetesConfigOutsideCluster'
import { AxiosRequestConfig } from 'axios'

const isInsideCluster = (): boolean => (
  !!process.env.KUBERNETES_SERVICE_HOST &&
  !!process.env.KUBERNETES_PORT_443_TCP_PORT
)

const getKubernetesConfig = (): Promise<AxiosRequestConfig> =>
  isInsideCluster()
    ? getKubernetesConfigInsideCluster()
    : getKubernetesConfigOutsideCluster()

export default getKubernetesConfig
