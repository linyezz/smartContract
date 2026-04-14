import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const venvDir = path.join(rootDir, '.venv-ocr-worker')
const requirementsFile = path.join(rootDir, 'src-tauri', 'resources', 'ocr-worker', 'requirements.txt')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: rootDir,
    env: process.env,
    ...options
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`)
  }
}

function resolveBootstrapPython() {
  const candidates = process.platform === 'win32'
    ? [
        { command: 'py', args: ['-3'] },
        { command: 'python', args: [] },
        { command: 'python3', args: [] }
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] }
      ]

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
      stdio: 'ignore',
      cwd: rootDir,
      env: process.env
    })
    if (result.status === 0) {
      return candidate
    }
  }

  throw new Error('No usable Python interpreter found for OCR worker setup.')
}

function resolveVenvPython() {
  const candidate = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')

  if (!existsSync(candidate)) {
    throw new Error(`OCR worker virtualenv is missing Python executable: ${candidate}`)
  }

  return candidate
}

const bootstrapPython = resolveBootstrapPython()
run(bootstrapPython.command, [...bootstrapPython.args, '-m', 'venv', venvDir])

const venvPython = resolveVenvPython()
run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'])
run(venvPython, ['-m', 'pip', 'install', '-r', requirementsFile])

console.log(`RapidOCR worker environment is ready: ${venvDir}`)
