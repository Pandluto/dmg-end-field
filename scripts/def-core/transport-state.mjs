export function createDefCoreTransportState({ writeSse }) {
  if (typeof writeSse !== 'function') throw new TypeError('DEF transport state requires writeSse');
  const commandClients = new Set();

  function addCommandClient(response) {
    commandClients.add(response);
  }

  function removeCommandClient(response) {
    commandClients.delete(response);
  }

  function broadcastCommands(commands) {
    const payload = { ok: true, protocolVersion: 1, commands };
    for (const client of Array.from(commandClients)) {
      if (!writeSse(client, 'main-workbench.commands', payload)) commandClients.delete(client);
    }
  }

  function heartbeat(now = Date.now()) {
    for (const client of Array.from(commandClients)) {
      if (!writeSse(client, 'heartbeat', { ok: true, now })) commandClients.delete(client);
    }
  }

  function close() {
    for (const client of Array.from(commandClients)) client.end();
    commandClients.clear();
  }

  return Object.freeze({
    addCommandClient,
    removeCommandClient,
    broadcastCommands,
    heartbeat,
    close,
    size: () => commandClients.size,
  });
}
