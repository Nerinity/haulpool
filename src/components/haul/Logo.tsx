/**
 * HaulPool mark: a highway-sign plate with a box truck, and a dashed lane line
 * splitting the cargo box — one truck, shared. Wordmark set in Overpass.
 */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect x="1.5" y="1.5" width="45" height="45" rx="10" fill="#0a6b45" />
      <rect x="4.5" y="4.5" width="39" height="39" rx="7.5" fill="none" stroke="#ffffff" strokeWidth="1.6" />
      {/* cargo box */}
      <rect x="9" y="15" width="21" height="15" rx="1.5" fill="#ffffff" />
      {/* lane line splitting the box */}
      <path d="M19.5 16.5v12" stroke="#ffc629" strokeWidth="2.4" strokeDasharray="3 2" />
      {/* cab */}
      <path d="M31 19h5.5l3.5 4.5V30H31z" fill="#ffffff" />
      <path d="M33 20.8h3l2 2.6h-5z" fill="#0a6b45" />
      {/* wheels */}
      <circle cx="15" cy="32.5" r="3" fill="#ffffff" stroke="#0a6b45" strokeWidth="1.6" />
      <circle cx="34.5" cy="32.5" r="3" fill="#ffffff" stroke="#0a6b45" strokeWidth="1.6" />
    </svg>
  )
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="text-lg font-extrabold tracking-tight text-foreground">HaulPool</span>
    </span>
  )
}

export const SLOGAN = 'Your stuff. Our truck. Half the price.'
