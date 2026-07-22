function npmConfigOption(environment, optionName) {
  const key = `npm_config_${optionName.replace(/^--/, '').replace(/-/g, '_')}`.toLowerCase();
  const entry = Object.entries(environment || {}).find(([name]) => name.toLowerCase() === key);
  return typeof entry?.[1] === 'string' ? entry[1].trim() : '';
}

export function readDefHarnessCliOption(args, optionName, environment = {}) {
  const values = Array.isArray(args) ? args : [];
  for (let index = 0; index < values.length; index += 1) {
    const value = String(values[index] || '');
    if (value === optionName) {
      const next = typeof values[index + 1] === 'string' ? values[index + 1].trim() : '';
      if (next && !next.startsWith('--')) return next;
      break;
    }
    if (value.startsWith(`${optionName}=`)) {
      const inline = value.slice(optionName.length + 1).trim();
      if (inline) return inline;
      break;
    }
  }
  return npmConfigOption(environment, optionName);
}

export function parseDefHarnessCliArguments(argv = [], environment = {}) {
  const [command = 'doctor', ...args] = Array.isArray(argv) ? argv : [];
  return {
    command,
    args,
    option: (name) => readDefHarnessCliOption(args, name, environment),
  };
}
