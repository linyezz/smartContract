#!/usr/bin/env node
// Regenerate src/data/chineseSurnames.js from zh-address-parse package data
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')
const SOURCE = resolve(projectRoot, 'node_modules/zh-address-parse/app/lib/names.json')
const TARGET = resolve(projectRoot, 'src/data/chineseSurnames.js')

const list = JSON.parse(readFileSync(SOURCE, 'utf-8'))
if (!Array.isArray(list) || list.length === 0) {
  throw new Error(`Unexpected source data at ${SOURCE}`)
}

const banner = [
  '// Auto-generated from zh-address-parse/app/lib/names.json (504 surnames)',
  '// Source: https://github.com/ldwonday/zh-address-parse',
  '// DO NOT edit manually. To regenerate: node scripts/build-surname-table.mjs',
]

const body = `export const SINGLE_SURNAMES = ${JSON.stringify(list, null, 0)};`
writeFileSync(TARGET, `${banner.join('\n')}\n${body}\n`)
console.log(`Written ${list.length} surnames to ${TARGET}`)
