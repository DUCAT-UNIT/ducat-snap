import type { DeploymentId } from '../../types';
import { accountKeySetFromRoleNodes } from '../../accounts';
import type { DucatKeyNode } from '../../bip32';

function deriveRoleNode(baseNode: DucatKeyNode, change: number): DucatKeyNode {
  return baseNode.deriveHardened(0).derive(change).derive(0);
}

/** Reproduces the complete role-node derivation for tests only. */
export function deriveAccountSetFromBaseNodes(
  network: DeploymentId,
  satsBaseNode: DucatKeyNode,
  taprootBaseNode: DucatKeyNode,
) {
  return accountKeySetFromRoleNodes(
    network,
    deriveRoleNode(satsBaseNode, 0),
    deriveRoleNode(taprootBaseNode, 0),
    deriveRoleNode(taprootBaseNode, 2),
  );
}
