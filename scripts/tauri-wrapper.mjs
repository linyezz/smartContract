import { execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const escapedRoot = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function safeExec(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function listPidsFromLsof() {
  const output = safeExec('lsof', ['-ti', 'tcp:1420'])
  return output
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function listWorkspaceProcessPids() {
  const output = safeExec('ps', ['aux'])
  const patterns = [
    new RegExp(`node .*${escapedRoot}.*/node_modules/.bin/vite`),
    new RegExp(`node .*${escapedRoot}.*/node_modules/.bin/tauri dev`),
    new RegExp(`cargo\\s+run .*${escapedRoot.replace(/\//g, '\\/')}\\/src-tauri`)
  ]

  return output
    .split('\n')
    .filter((line) => patterns.some((pattern) => pattern.test(line)))
    .map((line) => line.trim().split(/\s+/)[1])
    .filter(Boolean)
}

function killPids(pids) {
  const uniquePids = [...new Set(pids)].filter((pid) => pid && pid !== String(process.pid))
  if (!uniquePids.length) {
    return
  }
  try {
    execFileSync('kill', ['-9', ...uniquePids], { stdio: 'ignore' })
  } catch {
    // Ignore race conditions where the process exits before kill.
  }
}

function cleanupStaleProcesses() {
  const stalePids = [...listPidsFromLsof(), ...listWorkspaceProcessPids()]
  killPids(stalePids)
}

cleanupStaleProcesses()

const cliBin = path.join(projectRoot, 'node_modules', '.bin', 'tauri')
const cliArgs = process.argv.slice(2)
const child = spawn(cliBin, cliArgs, {
  stdio: 'inherit',
  shell: true
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
