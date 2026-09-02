import { checkCommands } from './verification-commands.mjs'
import { VerificationRun } from './verification-run.mjs'

const [mode, ...args] = process.argv.slice(2)
const commands = checkCommands(mode, args)
const run = new VerificationRun(mode, { selection: args })
let failure
try {
  for (const command of commands) await run.command(command.name, process.execPath, command.args)
} catch (error) {
  failure = error
} finally {
  await run.finish(failure)
}
