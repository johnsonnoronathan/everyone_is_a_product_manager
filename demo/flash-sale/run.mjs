// Starts the fake payment provider and one variant of the flash-sale app.
//   node demo/flash-sale/run.mjs naive
//   node demo/flash-sale/run.mjs fixed
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const variant = process.argv[2];
if (!['naive', 'fixed'].includes(variant)) {
  console.error('Usage: node demo/flash-sale/run.mjs <naive|fixed>');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const env = {
  ...process.env,
  PORT: process.env.PORT ?? '3000',
  PAYMENT_PORT: process.env.PAYMENT_PORT ?? '4100',
  // Demo-only defaults so the app starts without setup. Real deployments set these as secrets.
  PAYMENT_SECRET_KEY: process.env.PAYMENT_SECRET_KEY ?? 'demo-payment-key',
  TOKEN_SECRET: process.env.TOKEN_SECRET ?? 'demo-token-secret-change-me',
  ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? 'demo-admin-token',
  DEMO_LOGIN: process.env.DEMO_LOGIN ?? '1',
  ENABLE_TEST_ROUTES: process.env.ENABLE_TEST_ROUTES ?? '1',
  SEED_DEMO_DATA: process.env.SEED_DEMO_DATA ?? '1',
};
env.PAYMENT_URL = `http://127.0.0.1:${env.PAYMENT_PORT}`;

const nodeArgs = ['--disable-warning=ExperimentalWarning'];
const children = [
  spawn(process.execPath, [...nodeArgs, path.join(here, 'shared/fake-payment-provider.mjs')], { env, stdio: 'inherit' }),
  spawn(process.execPath, [...nodeArgs, path.join(here, variant, 'server.mjs')], { env, stdio: 'inherit' }),
];

const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', (code) => {
    if (code) console.error(`process exited with code ${code}`);
    stop();
    process.exitCode = code ?? 0;
  });
}
