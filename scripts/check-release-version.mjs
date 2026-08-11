import process from 'node:process';

const releaseRef = (process.argv[2] || process.env.GITHUB_REF_NAME || 'latest').trim();

// Application release tags are independent from the server resource channel.
// Official data and images are published through resources/stable.json.
console.log(`RELEASE_VERSION_ACCEPTED ref=${releaseRef}`);
