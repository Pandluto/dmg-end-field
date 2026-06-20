const path = require('node:path');
const { notarize } = require('@electron/notarize');

exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      '[notarize] skipped: set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID to enable notarization.'
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);

  console.log(`[notarize] submitting ${appPath}`);

  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });

  console.log('[notarize] completed');
};
