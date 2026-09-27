import { useEffect, useState } from 'react';
import { loadDeployment, type Deployment } from '../lib/deployment';

export type DeploymentState =
  | { status: 'loading' }
  | { status: 'ready'; deployment: Deployment }
  | { status: 'error'; error: string };

export function useDeployment(): DeploymentState {
  const [state, setState] = useState<DeploymentState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadDeployment()
      .then((deployment) => {
        if (!cancelled) setState({ status: 'ready', deployment });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
