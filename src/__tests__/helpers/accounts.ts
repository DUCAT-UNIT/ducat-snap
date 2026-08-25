import type { DeploymentId } from '../../types';
import { accountKeySetFromRoleNodes } from '../../accounts';
import type { DucatKeyNode } from '../../bip32';

function deriveAccountNode(baseNode: DucatKeyNode, index = 0): DucatKeyNode {
  return baseNode.deriveHardened(0).derive(0).derive(index);
}

/** Reproduces the pre-v1 parent-node derivation for tests only. */
export function deriveAccountSetFromBaseNodes(
  network: DeploymentId,
  satsBaseNode: DucatKeyNode,
  taprootBaseNode: DucatKeyNode,
) {
  return accountKeySetFromRoleNodes(
    network,
    deriveAccountNode(satsBaseNode),
    deriveAccountNode(taprootBaseNode),
    deriveAccountNode(taprootBaseNode, 1),
  );
}
