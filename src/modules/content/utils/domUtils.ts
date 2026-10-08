import { isProcessingResultNode as isProcessingPipelineNode } from '../../processing/DomTranslationPolicy';

/**
 * Check whether a node is a processing result node (translation, pronunciation, and other feature elements)
 */
export function isProcessingResultNode(node: Node): boolean {
  return isProcessingPipelineNode(node);
}

/**
 * Check whether a node is a descendant of any other node in the set
 */
export function isDescendant(node: Node, nodeSet: Set<Node>): boolean {
  let parent = node.parentElement;
  while (parent) {
    if (nodeSet.has(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}
