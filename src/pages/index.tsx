/**
 * Landing page — a STATIC page (no DeepSpace providers), prerendered at build.
 * Keep it renderable without a browser: no window/document during render.
 *
 * The one loud element is the highway sign carrying the slogan; everything else is quiet.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { seo } from '../seo'
import { Logo, SLOGAN } from '../components/haul/Logo'
import { TruckLoad } from '../components/haul/TruckLoad'

const DEMO = [
  { label: 'Maya, Morewood', cuFt: 140, fragileCuFt: 12, order: 1 },
  { label: 'You', cuFt: 61, mine: true, order: 2 },
  { label: 'Jordan, Shadyside', cuFt: 95, fragileCuFt: 8, order: 3 },
  { label: 'Li, North Oakland', cuFt: 120, order: 4 },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Logo />
          <Link to="/home" className="rounded-full px-4 py-2 text-sm font-semibold text-foreground hover:bg-secondary">Sign in</Link>
        </header>

        <main>
          {/* Hero: a guide sign on two posts */}
          <section className="mx-auto max-w-5xl px-5 pb-10 pt-6 sm:pt-10">
            <div className="hp-sign mx-auto max-w-3xl rounded-[22px] bg-primary p-2 shadow-[0_10px_30px_-12px_rgba(10,60,40,0.55)]">
              <div className="rounded-[16px] border-[3px] border-white/90 px-6 py-8 sm:px-10 sm:py-12">
                <p className="flex items-center gap-2 text-sm font-bold text-white/85">
                  <span className="inline-block h-5 w-9 rounded-sm bg-[var(--color-tape)]" aria-hidden />
                  Move-out day, shared
                </p>
                <h1 className="mt-4 text-[2.6rem] font-black leading-[1.02] tracking-tight text-white sm:text-6xl">
                  {SLOGAN.split('. ').map((line, i, all) => (
                    <span key={line} className="block">{i < all.length - 1 ? `${line}.` : line}</span>
                  ))}
                </h1>
              </div>
            </div>
            <div className="mx-auto flex max-w-3xl justify-around" aria-hidden>
              <span className="h-10 w-3 rounded-b-sm bg-[#8a948f]" />
              <span className="h-10 w-3 rounded-b-sm bg-[#8a948f]" />
            </div>

            <p className="mx-auto mt-6 max-w-xl text-center text-lg leading-relaxed text-muted-foreground">
              Moving out the same day as other students? Share one truck, around town or city to city, and pay only for the space your stuff takes.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/move" className="inline-flex h-12 items-center rounded-full bg-primary px-6 text-base font-bold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Plan my move
              </Link>
              <Link to="/search" className="inline-flex h-12 items-center rounded-full border-2 border-foreground/80 px-6 text-base font-bold text-foreground hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                Find a truck
              </Link>
            </div>
          </section>

          {/* The idea in one picture */}
          <section className="border-y border-border bg-card">
            <div className="mx-auto grid max-w-5xl items-center gap-8 px-5 py-12 md:grid-cols-[1.4fr_1fr]">
              <div>
                <TruckLoad capacityCuFt={764} usableCuFt={611} segments={DEMO} vehicleLabel="One 15' truck, four people" />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight">You pay for your part of the truck.</h2>
                <p className="mt-2 text-muted-foreground">Your 61 cu ft (a dorm room) is about 15% of what's on board, so you pay about 15% of the truck. Maya organized it, so she gets 10% off.</p>
                <div className="mt-5 flex items-end gap-6">
                  <div>
                    <p className="text-sm text-muted-foreground">Renting alone</p>
                    <p className="text-2xl font-bold text-muted-foreground line-through decoration-2">$54.23</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Sharing</p>
                    <p className="text-4xl font-black text-primary">$8.35</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">15' truck, 12 miles, $10 fuel, split four ways. Example prices; you'll see real ones for your truck.</p>
              </div>
            </div>
          </section>

          {/* How it works — a real sequence, so it's numbered */}
          <section className="mx-auto max-w-5xl px-5 py-14">
            <h2 className="text-2xl font-extrabold tracking-tight">How it works</h2>
            <ol className="mt-6 grid gap-6 md:grid-cols-3">
              {[
                ['Tell us what you’re moving', 'Snap a photo of your room or tap "Dorm room". We work out how much space it takes.'],
                ['Join a truck going your way', 'Same day, and on the way or to the same storage unit. Or start one and invite people.'],
                ['Split by space', 'Everyone pays for the space they use, to the cent. Organizers get 10% off.'],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--color-tape)] text-lg font-black text-[#3b2c00]">{i + 1}</span>
                  <div>
                    <h3 className="font-bold">{t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{d}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="mx-auto max-w-5xl px-5 pb-16">
            <dl className="grid gap-x-10 gap-y-6 border-t border-border pt-10 md:grid-cols-3">
              <div>
                <dt className="font-bold">Around town or city to city</dt>
                <dd className="mt-1 text-sm text-muted-foreground">Oakland to a storage unit for the summer, or Pittsburgh to New York for your new job.</dd>
              </div>
              <div>
                <dt className="font-bold">Nobody gets overbooked</dt>
                <dd className="mt-1 text-sm text-muted-foreground">Two people grabbing the last spot at once? Exactly one gets it.</dd>
              </div>
              <div>
                <dt className="font-bold">Your address stays private</dt>
                <dd className="mt-1 text-sm text-muted-foreground">Others see your area, not your door, until you're in the same truck.</dd>
              </div>
            </dl>
          </section>
        </main>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
            <Logo />
            <span>{SLOGAN}</span>
          </div>
        </footer>
      </div>
    </>
  )
}
