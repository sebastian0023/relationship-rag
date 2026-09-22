/* global console, process */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const stage = value('--stage');
const confirmed = args.includes('--confirm');
if (stage !== 'test') throw new Error('Alarm smoke tests are restricted to the test stage.');

const command = [
  'cloudwatch',
  'put-metric-data',
  '--namespace',
  'RelationshipRag',
  '--metric-data',
  'MetricName=RecordFailure,Value=1,Unit=Count,Dimensions=[{Name=Stage,Value=test},{Name=Service,Value=delivery}]',
];
if (!confirmed) {
  console.log(`Dry run: aws ${command.join(' ')}`);
  console.log('Repeat with --confirm after reviewing the test-stage target.');
  process.exit(0);
}
execFileSync('aws', command, { stdio: 'inherit' });
console.log(
  'Published the synthetic test-stage alarm metric. Verify alarm state and notification.',
);
