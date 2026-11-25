export const createHash = () => ({ update() { return this; }, digest: () => '0'.repeat(64) });
