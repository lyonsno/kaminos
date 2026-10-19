// Shared worker entry for the vantage hub (agent-vantage-hub.mjs): one per
// browser and Kaminos server, shared by every tab of that server.
import {createVantageHub} from './agent-vantage-hub.mjs';

const hub = createVantageHub({
  EventSource, fetch: (...args) => fetch(...args), now: () => Date.now(),
  hubId: `hub-${crypto.randomUUID()}`, setInterval, setTimeout,
});
self.onconnect = event => hub.connect(event.ports[0]);
