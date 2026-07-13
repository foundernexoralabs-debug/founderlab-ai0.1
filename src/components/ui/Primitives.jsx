import { useState } from 'react'
import { C } from '@/app/theme'

export function Button({ children, onClick, variant = 'primary', size = 'md', disabled, full, icon, style: extraStyle }) {
  const [hovered, setHovered] = useState(false)
  const sizes = {
    sm: { fontSize: 12, padding: '5px 10px' },
    md: { fontSize: 14, padding: '7px 14px' },
    lg: { fontSize: 14, padding: '12px 20px' },
  }
  const variants = {
    primary: { background: hovered ? '#4f46e5' : C.accent, color: '#fff', border: 'none' },
    secondary: { background: 'transparent', color: C.t1, border: '1px solid ' + (hovered ? C.borderHov : C.border) },
    ghost: { background: hovered ? C.surfHigh : 'transparent', color: C.t2, border: 'none' },
    danger: { background: hovered ? '#dc2626' : C.red, color: '#fff', border: 'none' },
    success: { background: hovered ? '#059669' : C.green, color: '#fff', border: 'none' },
  }

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 500,
        fontFamily: 'inherit',
        transition: 'all .15s',
        width: full ? '100%' : undefined,
        opacity: disabled ? 0.4 : 1,
        outline: 'none',
        ...sizes[size],
        ...variants[variant || 'primary'],
        ...extraStyle,
      }}
    >
      {icon && <span style={{ fontSize: 14 }}>{icon}</span>}
      {children}
    </button>
  )
}

export function Input({ value, onChange, placeholder, rows, type = 'text', onKeyDown, autoFocus, readOnly, style: extraStyle }) {
  const [focused, setFocused] = useState(false)
  const Component = rows ? 'textarea' : 'input'
  return (
    <Component
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      type={rows ? undefined : type}
      onKeyDown={onKeyDown}
      autoFocus={autoFocus}
      readOnly={readOnly}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ width: '100%', background: C.surf, border: '1px solid ' + (focused ? C.borderFocus : C.border), borderRadius: 8, color: C.t1, padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit', resize: rows ? 'vertical' : undefined, boxSizing: 'border-box', transition: 'all .15s', boxShadow: focused ? '0 0 0 3px ' + C.accentM : 'none', ...extraStyle }}
    />
  )
}

export function Card({ children, style, onClick, hover }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => hover && setHovered(true)}
      onMouseLeave={() => hover && setHovered(false)}
      style={{ background: C.surf, border: '1px solid ' + (hovered ? C.borderHov : C.border), borderRadius: 10, padding: 16, transition: 'all .15s', cursor: onClick ? 'pointer' : undefined, boxShadow: hovered ? '0 4px 24px #0007' : 'none', ...style }}
    >
      {children}
    </div>
  )
}

export function Badge({ children, color = 'accent' }) {
  const palette = {
    accent: [C.accentM, C.accent],
    green: [C.greenM, C.green],
    yellow: [C.yellowM, C.yellow],
    red: [C.redM, C.red],
    gray: [C.surfHigh, C.t2],
  }
  const [background, foreground] = palette[color] || palette.accent
  return <span style={{ background, color: foreground, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center' }}>{children}</span>
}

export function Spinner({ size = 20, color = C.accent }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'flSpin .8s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="31.4" strokeLinecap="round" />
    </svg>
  )
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, color: C.t2 }}>
      <div style={{ fontSize: 44, marginBottom: 16 }}>{icon}</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: C.t1, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 14, maxWidth: 300, margin: '0 auto 20px', lineHeight: 1.6 }}>{description}</div>
      {action}
    </div>
  )
}

export function Tip({ children }) {
  return (
    <div style={{ background: C.accentM, border: '1px solid rgba(99,102,241,.2)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: C.t2, display: 'flex', gap: 8, alignItems: 'flex-start', lineHeight: 1.5 }}>
      <span style={{ flexShrink: 0 }}>💡</span><span>{children}</span>
    </div>
  )
}
