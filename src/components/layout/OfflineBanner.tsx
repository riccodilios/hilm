export function OfflineBanner() {
  return (
    <div className="sticky top-0 z-30 border-b border-warning/20 bg-warning/10 px-4 py-2 text-center text-xs text-warning">
      You&apos;re offline — reading cached data. Changes require a connection.
    </div>
  )
}
