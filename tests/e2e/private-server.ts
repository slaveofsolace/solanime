// Separate fixture origin: the ordinary E2E catalogue remains public for its
// existing tests, while this process exercises the actual private-site gate.
process.env.SOLANIME_E2E_PRIVATE_SITE = 'true';
process.env.SOLANIME_ADMIN_TOKEN = 'private-fixture-operator-token-not-for-release';
await import('./server.ts');
export {};
