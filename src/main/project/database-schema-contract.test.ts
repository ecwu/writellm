import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createScanner, LanguageVariant, SyntaxKind } from 'typescript/unstable/ast'
import { describe, expect, it } from 'vitest'
import pino from 'pino'
import { migrateDatabase } from '../db/migrations'
import { projectMigrations } from './migrations'

type ColumnInfo = { name: string; type: string; notnull: number; pk: number }
type ExpectedColumn = { name: string; nullable: boolean; storageType: 'TEXT' | 'INTEGER' | null }
type SourceToken = {
  kind: SyntaxKind
  text: string
  start: number
  end: number
  hasPrecedingLineBreak: boolean
}
type Property = { name: string; type: string }
type Declarations = {
  interfaces: Map<string, string>
  aliases: Map<string, 'TEXT' | 'INTEGER' | null>
}

const databaseTypesPath = fileURLToPath(new URL('./database-types.ts', import.meta.url))

describe('project database schema contract', () => {
  it('matches every migrated table to the hand-maintained Kysely schema', () => {
    const database = new Database(':memory:')
    try {
      database.pragma('foreign_keys = ON')
      migrateDatabase(database, {
        applicationVersion: 'test',
        databaseRole: 'project',
        migrations: projectMigrations,
        log: pino({ level: 'silent' })
      })

      const expected = readExpectedSchema()
      const actualTables = (
        database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
          )
          .pluck()
          .all() as string[]
      ).sort()

      expect(actualTables).toEqual([...expected.keys()].sort())
      for (const [table, columns] of expected) {
        const actualColumns = database
          .prepare(`PRAGMA table_info("${table}")`)
          .all() as ColumnInfo[]
        expect(actualColumns.map((column) => column.name).sort(), table).toEqual(
          columns.map((column) => column.name).sort()
        )

        const actualByName = new Map(actualColumns.map((column) => [column.name, column]))
        for (const column of columns) {
          const actual = actualByName.get(column.name)
          expect(actual, `${table}.${column.name}`).toBeDefined()
          const actualNullable = actual !== undefined && actual.notnull === 0 && actual.pk === 0
          expect(actualNullable, `${table}.${column.name} nullability`).toBe(column.nullable)
          if (column.storageType !== null) {
            expect(actual?.type.toUpperCase(), `${table}.${column.name} storage type`).toBe(
              column.storageType
            )
          }
        }
      }
    } finally {
      database.close()
    }
  })

  it('fails closed for schema syntax outside the contract parser', () => {
    expect(parseProperties('{ value: "}"\n  next: string }')).toHaveLength(2)
    expect(() => parseProperties('{ optional?: string }')).toThrow(
      /Optional database type property/
    )
    expect(() => parseProperties('{ "quoted": string }')).toThrow(
      /Unsupported database type property/
    )
    expect(() => readDeclarations('export interface Table extends Base {}')).toThrow(
      /Unsupported interface declaration/
    )
  })
})

function readExpectedSchema(): Map<string, ExpectedColumn[]> {
  const source = readFileSync(databaseTypesPath, 'utf8')
  const declarations = readDeclarations(source)
  const schema = declarations.interfaces.get('ProjectDatabaseSchema')
  if (!schema) throw new Error('ProjectDatabaseSchema is missing')

  const result = new Map<string, ExpectedColumn[]>()
  for (const property of parseProperties(schema)) {
    result.set(
      property.name,
      resolveColumns(property.type, declarations.interfaces, declarations.aliases)
    )
  }
  return result
}

function readDeclarations(source: string): Declarations {
  const tokens = tokenize(source)
  const interfaces = new Map<string, string>()
  const aliases = new Map<string, 'TEXT' | 'INTEGER' | null>()

  for (let index = 0; index < tokens.length; index += 1) {
    const exportToken = tokens[index]
    if (exportToken?.kind !== SyntaxKind.ExportKeyword) continue

    const kind = tokens[index + 1]
    const name = tokens[index + 2]
    if (!kind || !name || !isIdentifier(name)) {
      throw new Error('Unsupported exported declaration in database-types.ts')
    }

    if (kind.kind === SyntaxKind.InterfaceKeyword) {
      const open = tokens[index + 3]
      if (open?.text !== '{') {
        throw new Error(`Unsupported interface declaration ${name.text}`)
      }
      const closeIndex = findMatchingBrace(tokens, index + 3)
      const close = tokens[closeIndex]
      if (!close) throw new Error(`Unclosed interface ${name.text}`)
      interfaces.set(name.text, source.slice(open.start, close.end))
      index = closeIndex
      continue
    }

    if (kind.kind === SyntaxKind.TypeKeyword) {
      const equals = tokens[index + 3]
      if (equals?.text !== '=') {
        throw new Error(`Unsupported type alias ${name.text}`)
      }
      const bodyStart = tokens[index + 4]
      if (!bodyStart) throw new Error(`Empty type alias ${name.text}`)
      const bodyEndIndex = findTypeAliasEnd(tokens, index + 4)
      const bodyEnd = tokens[bodyEndIndex]
      const body = source.slice(bodyStart.start, bodyEnd?.start ?? source.length).trim()
      if (!body) throw new Error(`Empty type alias ${name.text}`)
      aliases.set(name.text, classifyStorageType(body))
      index = bodyEndIndex - 1
    }
  }

  return { interfaces, aliases }
}

function resolveColumns(
  type: string,
  interfaces: Map<string, string>,
  aliases: Map<string, 'TEXT' | 'INTEGER' | null>
): ExpectedColumn[] {
  const normalized = type.trim()
  const reference = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1]
  if (reference) {
    const declaration = interfaces.get(reference)
    if (!declaration) throw new Error(`Unknown database table type ${reference}`)
    return propertiesToColumns(parseProperties(declaration), aliases)
  }
  if (normalized.startsWith('{')) {
    return propertiesToColumns(parseProperties(normalized), aliases)
  }
  throw new Error(`Unsupported database table type ${normalized}`)
}

function propertiesToColumns(
  properties: Property[],
  aliases: Map<string, 'TEXT' | 'INTEGER' | null>
): ExpectedColumn[] {
  return properties.map((property) => ({
    name: property.name,
    nullable: isNullable(property.type),
    storageType: storageType(property.type, aliases)
  }))
}

function parseProperties(block: string): Property[] {
  const tokens = tokenize(block)
  const open = tokens[0]
  if (open?.text !== '{') throw new Error('Expected a database type body')
  const closeIndex = findMatchingBrace(tokens, 0)
  if (closeIndex !== tokens.length - 1) {
    throw new Error('Unexpected tokens after a database type body')
  }
  const properties: Property[] = []
  let index = 1
  while (index < closeIndex) {
    while (index < closeIndex && isSeparator(tokens[index])) index += 1
    if (index >= closeIndex) break

    const start = propertyStart(tokens, index)
    if (!start) throw new Error(`Unsupported database type property near ${tokens[index]?.text}`)
    if (start.optional)
      throw new Error(`Optional database type property ${start.name} is unsupported`)

    const typeStart = tokens[start.colonIndex + 1]
    if (!typeStart || typeStart.start >= tokens[closeIndex].start) {
      throw new Error(`Missing type for database property ${start.name}`)
    }

    let cursor = start.colonIndex + 1
    let braceDepth = 0
    let parenthesisDepth = 0
    let bracketDepth = 0
    while (cursor < closeIndex) {
      const token = tokens[cursor]
      if (token.text === '{') braceDepth += 1
      if (token.text === '}') {
        if (braceDepth === 0) throw new Error(`Unbalanced database type near ${token.text}`)
        braceDepth -= 1
      }
      if (token.text === '(') parenthesisDepth += 1
      if (token.text === ')') {
        if (parenthesisDepth === 0) throw new Error(`Unbalanced database type near ${token.text}`)
        parenthesisDepth -= 1
      }
      if (token.text === '[') bracketDepth += 1
      if (token.text === ']') {
        if (bracketDepth === 0) throw new Error(`Unbalanced database type near ${token.text}`)
        bracketDepth -= 1
      }

      if (braceDepth === 0 && parenthesisDepth === 0 && bracketDepth === 0) {
        if (isSeparator(token)) break
        if (token.hasPrecedingLineBreak && propertyStart(tokens, cursor)) break
      }
      cursor += 1
    }

    if (braceDepth !== 0 || parenthesisDepth !== 0 || bracketDepth !== 0) {
      throw new Error(`Unbalanced type for database property ${start.name}`)
    }
    const end = tokens[cursor]?.start ?? tokens[closeIndex]?.start
    const propertyType = block.slice(typeStart.start, end).trim()
    if (!propertyType) throw new Error(`Missing type for database property ${start.name}`)
    properties.push({ name: start.name, type: propertyType })
    index = cursor
  }

  if (properties.length === 0) throw new Error('Database type body has no properties')
  return properties
}

function propertyStart(
  tokens: SourceToken[],
  index: number
): { name: string; colonIndex: number; optional: boolean } | undefined {
  const name = tokens[index]
  if (!name || !isPropertyName(name)) return undefined
  const optional = tokens[index + 1]?.text === '?'
  const colonIndex = index + (optional ? 2 : 1)
  if (tokens[colonIndex]?.text !== ':') return undefined
  return { name: name.text, colonIndex, optional }
}

function storageType(
  type: string,
  aliases: Map<string, 'TEXT' | 'INTEGER' | null>
): ExpectedColumn['storageType'] {
  const direct = classifyStorageType(type)
  if (direct !== null) return direct
  const alias = tokenize(type).find(
    (token) => isIdentifier(token) && /^[A-Z][A-Za-z0-9_]*$/.test(token.text)
  )?.text
  return alias !== undefined && aliases.has(alias) ? (aliases.get(alias) ?? null) : null
}

function classifyStorageType(type: string): 'TEXT' | 'INTEGER' | null {
  const tokens = tokenize(type)
  if (tokens.some((token) => token.kind === SyntaxKind.NumberKeyword)) return 'INTEGER'
  if (
    tokens.some(
      (token) => token.kind === SyntaxKind.StringKeyword || token.kind === SyntaxKind.StringLiteral
    )
  ) {
    return 'TEXT'
  }
  return null
}

function isNullable(type: string): boolean {
  return tokenize(type).some((token) => token.kind === SyntaxKind.NullKeyword)
}

function tokenize(source: string): SourceToken[] {
  const scanner = createScanner(true, LanguageVariant.Standard, source)
  const tokens: SourceToken[] = []
  while (true) {
    const kind = scanner.scan()
    if (kind === SyntaxKind.EndOfFile) return tokens
    if (scanner.isUnterminated()) throw new Error('Unterminated token in database-types.ts')
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      start: scanner.getTokenStart(),
      end: scanner.getTokenEnd(),
      hasPrecedingLineBreak: scanner.hasPrecedingLineBreak()
    })
  }
}

function findMatchingBrace(tokens: SourceToken[], openIndex: number): number {
  let depth = 0
  for (let index = openIndex; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token?.text === '{') depth += 1
    if (token?.text === '}') {
      depth -= 1
      if (depth === 0) return index
      if (depth < 0) throw new Error('Unbalanced database type body')
    }
  }
  throw new Error('Unclosed database type body')
}

function findTypeAliasEnd(tokens: SourceToken[], startIndex: number): number {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token?.kind === SyntaxKind.ExportKeyword) return index
  }
  return tokens.length
}

function isIdentifier(token: SourceToken | undefined): token is SourceToken {
  return token?.kind === SyntaxKind.Identifier
}

function isPropertyName(token: SourceToken | undefined): token is SourceToken {
  return token !== undefined && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token.text)
}

function isSeparator(token: SourceToken | undefined): boolean {
  return token?.text === ';' || token?.text === ','
}
