// Defines the required Next.js App Router project shape that FounderLab
// Builder always generates, plus real (non-placeholder, non-AI-generated)
// boilerplate config files — hand-written so they're guaranteed correct.

export const REQUIRED_PAGES = [
  { route: '/',         name: 'Home',     file: 'app/page.tsx' },
  { route: '/features', name: 'Features', file: 'app/features/page.tsx' },
  { route: '/pricing',  name: 'Pricing',  file: 'app/pricing/page.tsx' },
  { route: '/about',    name: 'About',    file: 'app/about/page.tsx' },
  { route: '/contact',  name: 'Contact',  file: 'app/contact/page.tsx' },
  { route: '/dashboard',name: 'Dashboard',file: 'app/dashboard/page.tsx' },
  { route: '/login',    name: 'Login',    file: 'app/login/page.tsx' },
  { route: '/signup',   name: 'Signup',   file: 'app/signup/page.tsx' },
]

export const REQUIRED_COMPONENTS = [
  'components/Navbar.tsx',
  'components/Footer.tsx',
  'components/Button.tsx',
  'components/GlassCard.tsx',
  'components/Skeleton.tsx',
]

export const CONFIG_FILES = () => ([
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'founderlab-app',
      version: '0.1.0',
      private: true,
      scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
      dependencies: {
        next: '^14.2.0',
        react: '^18.3.0',
        'react-dom': '^18.3.0',
      },
      devDependencies: {
        typescript: '^5.4.0',
        '@types/node': '^20.11.0',
        '@types/react': '^18.3.0',
        '@types/react-dom': '^18.3.0',
        tailwindcss: '^3.4.0',
        postcss: '^8.4.0',
        autoprefixer: '^10.4.0',
      },
    }, null, 2),
  },
  {
    path: 'tsconfig.json',
    content: JSON.stringify({
      compilerOptions: {
        target: 'ES2017', lib: ['dom','dom.iterable','esnext'], allowJs: true, skipLibCheck: true,
        strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler',
        resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', incremental: true,
        plugins: [{ name: 'next' }],
        paths: { '@/*': ['./*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2),
  },
  { path: 'next.config.js', content: `/** @type {import('next').NextConfig} */\nconst nextConfig = {}\nmodule.exports = nextConfig\n` },
  {
    path: 'tailwind.config.ts',
    content: `import type { Config } from 'tailwindcss'\n\nconst config: Config = {\n  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],\n  theme: {\n    extend: {\n      colors: {\n        bg: '#09090f',\n        surface: '#0f0f1a',\n        accent: '#6366f1',\n      },\n      backdropBlur: { xs: '2px' },\n      fontFamily: { sans: ['Inter', 'sans-serif'] },\n    },\n  },\n  plugins: [],\n}\nexport default config\n`,
  },
  { path: 'postcss.config.js', content: `module.exports = {\n  plugins: { tailwindcss: {}, autoprefixer: {} },\n}\n` },
  { path: '.gitignore', content: `node_modules/\n.next/\nout/\n.env*.local\n.vercel\n*.tsbuildinfo\n` },
])

export function pagePrompt(overview, style, designLine) {
  return REQUIRED_PAGES.map(p => `- ${p.file} (route ${p.route}): the "${p.name}" page`).join('\n')
}

const DESIGN_SYSTEM_KEYWORDS = ['premium','luxury','modern','glass','style','look','feel','aesthetic','theme','color','colour','typography','font','vibe','mood']
const DESIGN_SYSTEM_FILES = ['app/globals.css','components/Navbar.tsx','components/Footer.tsx','components/Button.tsx','components/GlassCard.tsx']

// Classify a natural-language edit instruction against the real file set.
// Returns one of:
//   { type:'file', paths:['app/pricing/page.tsx'] }        — a specific named page/component
//   { type:'design-system', paths:[...DESIGN_SYSTEM_FILES] } — whole-site aesthetic change
export function classifyProjectEdit(instruction, files) {
  const lower = instruction.toLowerCase()

  // Specific page name mentioned (e.g. "add a testimonial to pricing")
  for (const p of REQUIRED_PAGES) {
    if (lower.includes(p.name.toLowerCase())) return { type:'file', paths:[p.file] }
  }
  // Specific component name mentioned (e.g. "improve the navbar")
  for (const f of files) {
    if (!f.path.startsWith('components/')) continue
    const base = f.path.split('/').pop().replace(/\.tsx?$/,'').toLowerCase()
    if (lower.includes(base)) return { type:'file', paths:[f.path] }
  }
  // Whole-site aesthetic request
  if (DESIGN_SYSTEM_KEYWORDS.some(k => lower.includes(k))) {
    return { type:'design-system', paths: DESIGN_SYSTEM_FILES.filter(p => files.some(f => f.path === p)) }
  }
  // Fallback: safest minimal-blast-radius default
  return { type:'file', paths:['app/globals.css'] }
}
