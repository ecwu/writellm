function Versions(): React.JSX.Element {
  return (
    <ul className='versions'>
      <li className='electron-version'>Electron desktop</li>
      <li className='chrome-version'>Sandboxed renderer</li>
      <li className='node-version'>Narrow IPC bridge</li>
    </ul>
  )
}

export default Versions
