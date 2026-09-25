/* global process, console */
import { releaseCommitSchema, releaseDigestSchema } from '@relationship-rag/contracts';
import { required, aws, verifyAccount } from './io.mjs';
try {
  const mode = process.argv[2];
  if (mode === 'candidate') {
    releaseCommitSchema.parse(required('RELEASE_COMMIT'));
    for (const key of [
      'AWS_REGION',
      'EXPECTED_AWS_ACCOUNT_ID',
      'RELEASE_BUCKET',
      'ALERT_EMAIL',
      'RELEASE_OWNER_USERNAME',
      'RELEASE_OWNER_PASSWORD',
      'RELEASE_PARTNER_USERNAME',
      'RELEASE_PARTNER_PASSWORD',
      'RELEASE_OUTSIDER_USERNAME',
      'RELEASE_OUTSIDER_PASSWORD',
    ])
      required(key);
    if (
      !/^\d{12}$/.test(required('EXPECTED_AWS_ACCOUNT_ID')) ||
      !/^\S+@\S+\.\S+$/.test(required('ALERT_EMAIL'))
    )
      throw new Error();
  } else if (mode === 'promotion') {
    releaseCommitSchema.parse(required('RELEASE_COMMIT'));
    releaseDigestSchema.parse(required('RELEASE_DIGEST'));
    for (const key of ['AWS_REGION', 'EXPECTED_AWS_ACCOUNT_ID', 'RELEASE_BUCKET', 'ALERT_EMAIL'])
      required(key);
  } else if (mode === 'storage') {
    verifyAccount();
    const bucket = required('RELEASE_BUCKET');
    const block = aws([
      's3api',
      'get-public-access-block',
      '--bucket',
      bucket,
    ]).PublicAccessBlockConfiguration;
    if (
      !['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'].every(
        (key) => block[key] === true,
      )
    )
      throw new Error();
    if (aws(['s3api', 'get-bucket-versioning', '--bucket', bucket]).Status !== 'Enabled')
      throw new Error();
    if (
      !aws(['s3api', 'get-bucket-encryption', '--bucket', bucket]).ServerSideEncryptionConfiguration
        .Rules.length
    )
      throw new Error();
  } else throw new Error();
} catch {
  console.error('Release prerequisites are incomplete. See phase-8-release.md.');
  process.exitCode = 1;
}
