/* global process */
const required = ['ALERT_EMAIL', 'TEST_USERNAME', 'TEST_PASSWORD'];
for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for live validation.`);
}
if (!/^\S+@\S+\.\S+$/.test(process.env.ALERT_EMAIL ?? ''))
  throw new Error('ALERT_EMAIL must be a valid address.');
