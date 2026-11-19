export default function BrowserMonitorPanel({ support, result }) {
  return <section className="browser-monitor" aria-live="polite">
    <h2>Browser Monitor Check</h2>
    <p>API status: {support.supported ? 'Supported' : 'Unavailable'}</p>
    {!result && <p>Run the browser check to request display permission and see browser-visible monitors.</p>}
    {result && <>
      <h3 className={result.status}>{result.status}</h3>
      <p>{result.message}</p>
      {result.screenCount !== null && <p>Detected screens: {result.screenCount}</p>}
      {result.screens.length > 0 && <div className="screen-details">
        {result.screens.map((screen, index) => <article key={`${screen.label}-${index}`}>
          <strong>{screen.label}</strong>
          <span>{screen.width} × {screen.height}</span>
          <span>{screen.isPrimary ? 'Primary screen' : 'Extended screen'}</span>
        </article>)}
      </div>}
    </>}
    <p className="browser-note">Browser results may exclude mirrored displays and are not equivalent to native OS-level detection. They do not change the native interview policy.</p>
  </section>;
}
