import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const venvDir = path.join(rootDir, '.venv-ocr-worker')
const workerScript = path.join(rootDir, 'src-tauri', 'resources', 'ocr-worker', 'rapidocr_worker.py')
const buildRoot = path.join(rootDir, '.pyinstaller-rapidocr-worker')
const distDir = path.join(buildRoot, 'dist')
const workDir = path.join(buildRoot, 'build')
const specDir = path.join(buildRoot, 'spec')
const configDir = path.join(buildRoot, 'config')
const targetDir = path.join(rootDir, 'src-tauri', 'binaries')
const binaryName = process.platform === 'win32' ? 'rapidocr-worker.exe' : 'rapidocr-worker'

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

function resolveVenvPython() {
  const candidate = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python')

  if (!existsSync(candidate)) {
    throw new Error(`OCR worker virtualenv is missing Python executable: ${candidate}`)
  }

  return candidate
}

mkdirSync(targetDir, { recursive: true })

const venvPython = resolveVenvPython()
run(
  venvPython,
  [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onefile',
    '--name',
    'rapidocr-worker',
    '--distpath',
    distDir,
    '--workpath',
    workDir,
    '--specpath',
    specDir,
    // RapidOCR ships config.yaml and ONNX model files as package data.
    // Without collecting them explicitly, the packaged Windows worker fails at runtime.
    '--collect-all',
    'rapidocr_onnxruntime',
    workerScript
  ],
  {
    env: {
      ...process.env,
      PYINSTALLER_CONFIG_DIR: configDir
    }
  }
)

copyFileSync(path.join(distDir, binaryName), path.join(targetDir, binaryName))
console.log(`RapidOCR worker binary generated at: ${path.join(targetDir, binaryName)}`)
