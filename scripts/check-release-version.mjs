import process from 'node:process';

const releaseRef = (process.argv[2] || process.env.GITHUB_REF_NAME || 'latest').trim();

// GitHub Releases is the source of truth for published data. The ref may be a
// semantic version, an LTS label, or another repository-controlled release
// name; it must not be compared with package.json.
console.log(`RELEASE_VERSION_ACCEPTED ref=${releaseRef}`);
