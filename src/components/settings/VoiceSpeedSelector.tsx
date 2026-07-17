import React from 'react'
import { VoiceConfig, VoiceProvider, Gender, ELEVENLABS_VOICES } from '@/lib/voiceService'

const C = {
  bg:     '#09090f', surf: '#0f0f1a', surfHigh: '#15152a',
  border: 'rgba(255,255,255,.07)', borderFocus: 'rgba(99,102,241,.5)',
  accent: '#6366f1', accentM: 'rgba(99,102,241,.12)',
  t1: '#eeeef8', t2: '#8888b0', t3: '#44445a',
  green: '#10b981',
}

const PROVIDERS: { id: VoiceProvider; label: string; badge?: string }[] = [
  { id: 'browser',    label: '🌐 Browser Neural', badge: 'Free' },
  { id: 'elevenlabs', label: '⚡ ElevenLabs',     badge: 'Premium' },
]
const GENDERS: { id: Gender; label: string; voices: { browser: string; elevenlabs: string } }[] = [
  { id: 'female', label: 'Talia', voices: { browser: 'Sonia Neural', elevenlabs: ELEVENLABS_VOICES.female.name } },
  { id: 'male',   label: 'Eddie', voices: { browser: 'Ryan Neural', elevenlabs: ELEVENLABS_VOICES.male.name } },
]

export default function VoiceSpeedSelector({
  config,
  onChange,
  elAvailable,
}: {
  config:      VoiceConfig
  onChange:    (c: VoiceConfig) => void
  elAvailable: boolean | null
}) {
  const pill = (active: boolean, onClick: () => void, children: React.ReactNode, disabled = false) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '7px 16px', borderRadius: 999, border: `1px solid ${active ? C.accent : C.border}`,
        background: active ? C.accentM : 'transparent', color: active ? C.accent : C.t2,
        cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500,
        fontFamily: 'inherit', opacity: disabled ? 0.45 : 1, transition: 'all .15s',
        display: 'flex', alignItems: 'center', gap: 6,
      }}
    >
      {children}
    </button>
  )

  const activeVoiceName = config.provider === 'elevenlabs'
    ? ELEVENLABS_VOICES[config.gender].name
    : (config.gender === 'male' ? 'Ryan Neural' : 'Sonia Neural')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Provider */}
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: C.t3, textTransform: 'uppercase', letterSpacing: '.06em' }}>Engine</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PROVIDERS.map(p => pill(
            config.provider === p.id,
            () => onChange({ ...config, provider: p.id }),
            <>
              {p.label}
              <span style={{ fontSize: 10, background: p.id === 'elevenlabs' ? C.accent : C.border, color: p.id === 'elevenlabs' ? '#fff' : C.t3, padding: '1px 6px', borderRadius: 99 }}>{p.badge}</span>
              {p.id === 'elevenlabs' && elAvailable === false && <span style={{ fontSize: 10, color: '#f59e0b' }}>no key</span>}
              {p.id === 'elevenlabs' && elAvailable === true  && <span style={{ fontSize: 10, color: C.green }}>✓</span>}
            </>,
            p.id === 'elevenlabs' && elAvailable === false,
          ))}
        </div>
      </div>

      {/* Gender */}
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: C.t3, textTransform: 'uppercase', letterSpacing: '.06em' }}>Voice</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {GENDERS.map(g => pill(
            config.gender === g.id,
            () => onChange({ ...config, gender: g.id }),
            <>
              {g.label}
              <span style={{ fontSize: 11, color: config.gender === g.id ? C.accent : C.t3, fontWeight: 400 }}>
                — {config.provider === 'elevenlabs' ? g.voices.elevenlabs : g.voices.browser}
              </span>
            </>,
          ))}
        </div>
      </div>

      {/* Speed */}
      <div>
        <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: C.t3, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Speed — <span style={{ color: C.t2, textTransform: 'none', fontWeight: 400 }}>{config.speed === 0 ? 'Normal' : config.speed > 0 ? `+${config.speed}% faster` : `${Math.abs(config.speed)}% slower`}</span>
        </p>
        <input
          type="range" min={-50} max={50} value={config.speed}
          onChange={e => onChange({ ...config, speed: parseInt(e.target.value, 10) })}
          style={{ width: '100%', accentColor: C.accent, cursor: 'pointer' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.t3, marginTop: 4 }}>
          <span>0.5× slower</span>
          <span>Normal</span>
          <span>1.5× faster</span>
        </div>
      </div>

      {/* Active voice label */}
      <div style={{ padding: '10px 14px', background: C.surf, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, color: C.t2 }}>
        Active voice: <strong style={{ color: C.t1 }}>{activeVoiceName}</strong>
        {config.provider === 'browser' && <span style={{ color: C.t3 }}> · Browser neural (free) · Best on Windows/Edge</span>}
        {config.provider === 'elevenlabs' && <span style={{ color: C.green }}> · ElevenLabs premium · Falls back to browser if quota exceeded</span>}
      </div>
    </div>
  )
}
