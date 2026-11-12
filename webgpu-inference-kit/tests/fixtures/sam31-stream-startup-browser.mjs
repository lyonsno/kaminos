import assert from 'node:assert/strict';

export const chromium = {
  async launchPersistentContext() {
    const page = {
      setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, on() {},
      async goto(url) {
        const response = await fetch(new URL('/favicon.ico', url));
        assert.equal(response.status, 204, 'the runner must serve a harmless favicon response without hiding other missing resources');
        assert.equal((await fetch(new URL('/missing-real-resource', url))).status, 404);
        throw new Error('startup-http-fixture-stop');
      },
      async evaluate() { return 'startup-http-fixture'; },
    };
    return { pages: () => [page], async close() {} };
  },
};
