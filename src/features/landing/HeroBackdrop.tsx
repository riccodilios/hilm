export function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_-5%,rgba(96,165,250,0.16),transparent),radial-gradient(ellipse_45%_35%_at_85%_55%,rgba(45,212,191,0.07),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_35%,rgba(10,10,11,0.55)_72%,#0a0a0b_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  )
}
