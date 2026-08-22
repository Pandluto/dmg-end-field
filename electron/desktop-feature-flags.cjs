'use strict';

/**
 * Frozen Desktop product entries.
 *
 * The underlying Agent and resource packager implementations stay in the
 * repository and release build, but the Electron Shell, preload bridge, and
 * IPC router must not expose them while these flags are false.
 */
module.exports = Object.freeze({
  agentEntry: false,
  resourcePackagerEntry: false,
});
