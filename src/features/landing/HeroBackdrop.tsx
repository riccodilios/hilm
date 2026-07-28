import { motion, useReducedMotion } from 'framer-motion'

export function HeroBackdrop() {
  const reduce = useReducedMotion()

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(96,165,250,0.18),transparent),radial-gradient(ellipse_50%_40%_at_80%_60%,rgba(45,212,191,0.08),transparent),radial-gradient(ellipse_40%_30%_at_10%_80%,rgba(255,255,255,0.04),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(10,10,11,0.4)_70%,#0a0a0b_100%)]" />

      {!reduce ? (
        <>
          <motion.div
            className="absolute left-[8%] top-[22%] h-40 w-56 rounded-2xl border border-white/8 bg-white/[0.03] shadow-[0_0_80px_rgba(96,165,250,0.08)] backdrop-blur-md"
            animate={{ y: [0, -12, 0], rotate: [-2, 1, -2] }}
            transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="space-y-2 p-4">
              <div className="h-2 w-16 rounded bg-white/15" />
              <div className="h-2 w-28 rounded bg-white/10" />
              <div className="h-2 w-20 rounded bg-white/10" />
            </div>
          </motion.div>
          <motion.div
            className="absolute right-[6%] top-[28%] h-44 w-52 rounded-2xl border border-white/8 bg-white/[0.035] backdrop-blur-md"
            animate={{ y: [0, 14, 0], rotate: [2, -1, 2] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          >
            <div className="space-y-2.5 p-4">
              <div className="flex gap-2">
                <div className="size-2 rounded-full bg-success/50" />
                <div className="h-2 w-20 rounded bg-white/15" />
              </div>
              <div className="h-16 rounded-lg bg-white/[0.04]" />
              <div className="h-2 w-24 rounded bg-white/10" />
            </div>
          </motion.div>
          <motion.div
            className="absolute bottom-[18%] left-[18%] hidden h-28 w-64 rounded-2xl border border-white/8 bg-white/[0.03] backdrop-blur-md sm:block"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          >
            <div className="flex h-full items-center gap-3 px-5">
              <div className="size-8 rounded-lg bg-info/20" />
              <div className="space-y-2">
                <div className="h-2 w-32 rounded bg-white/15" />
                <div className="h-2 w-20 rounded bg-white/10" />
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </div>
  )
}
