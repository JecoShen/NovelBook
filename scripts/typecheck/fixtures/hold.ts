import { spawn } from 'node:child_process'

spawn(process.execPath, [
  '-e',
  'setInterval(() => {}, 1_000)',
], {
  stdio: 'ignore',
})

await new Promise<void>(() => {})
