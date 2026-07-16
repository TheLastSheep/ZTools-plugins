import type { VaultObjectDescriptor, VaultObjectEnvelope } from "./crypto-contract";

export type VaultObjectCipher = {
  encryptObject(descriptor: VaultObjectDescriptor, value: unknown): VaultObjectEnvelope;
  decryptEnvelope(envelope: VaultObjectEnvelope): Promise<unknown>;
};

export function envelopeDescriptor(
  envelope: VaultObjectEnvelope,
): VaultObjectDescriptor {
  return {
    version: envelope.version,
    objectType: envelope.objectType,
    objectId: envelope.objectId,
    revision: envelope.revision,
  };
}
