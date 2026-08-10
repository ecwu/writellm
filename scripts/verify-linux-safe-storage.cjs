const { app, safeStorage } = require('electron')

const EXPECTED_PASSWORD_STORE = 'gnome-libsecret'
const EXPECTED_BACKEND = 'gnome_libsecret'
const PROBE_VALUE = 'writellm-linux-safe-storage-probe'

async function verifyLinuxSafeStorage() {
  if (process.platform !== 'linux') {
    throw new Error(`Linux safeStorage probe cannot run on ${process.platform}`)
  }

  await app.whenReady()

  const requestedPasswordStore = app.commandLine.getSwitchValue('password-store')
  const backend = safeStorage.getSelectedStorageBackend()
  const available = safeStorage.isEncryptionAvailable()

  if (requestedPasswordStore !== EXPECTED_PASSWORD_STORE) {
    throw new Error(
      `Expected --password-store=${EXPECTED_PASSWORD_STORE}, received ${requestedPasswordStore || 'none'}`
    )
  }
  if (!available || backend !== EXPECTED_BACKEND) {
    throw new Error(
      `Secure Linux credential backend unavailable: available=${available} backend=${backend}`
    )
  }

  const encrypted = safeStorage.encryptString(PROBE_VALUE)
  const roundTrip = safeStorage.decryptString(encrypted) === PROBE_VALUE
  if (!roundTrip) {
    throw new Error('Linux safeStorage encrypted round-trip failed')
  }

  process.stdout.write(
    `${JSON.stringify({ linuxSafeStorage: true, available, backend, roundTrip })}\n`
  )
}

verifyLinuxSafeStorage().then(
  () => app.exit(0),
  (err) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`)
    app.exit(1)
  }
)
