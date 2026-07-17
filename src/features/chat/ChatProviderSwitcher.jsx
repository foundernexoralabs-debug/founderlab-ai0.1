import { useEffect, useRef, useState } from 'react'
import { C } from '@/app/theme'
import {
  getChatModelOptions,
  getChatProviderOptions,
} from './chatProviderUtils'

function ProviderOption({ option, active, onSelect }) {
  return (
    <button
      type="button"
      className={`fl-chat-provider-option ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={() => onSelect(option.id)}
    >
      <span aria-hidden="true" className={`fl-chat-provider-option-icon ${option.local ? 'is-local' : ''}`}>{option.icon}</span>
      <span className="fl-chat-provider-option-copy">
        <strong>{option.name}</strong>
        <small>{option.description}</small>
      </span>
      {active && <span className="fl-chat-provider-option-check" aria-label="Selected">✓</span>}
    </button>
  )
}

/** A compact, chat-scoped provider and model picker backed by the central registry. */
export function ChatProviderSwitcher({
  provider,
  availability = {},
  localModels = [],
  localState = 'idle',
  onSelectProvider,
  onSelectModel,
  onDiscoverLocal,
  onOpenSettings,
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const options = getChatProviderOptions(availability)
  const cloudOptions = options.filter((option) => !option.local)
  const localOption = options.find((option) => option.local)
  const modelOptions = getChatModelOptions(provider.id, { localModels, selectedModel: provider.modelId })
  const discovering = localState === 'discovering'
  const localFailure = localState === 'failed'

  useEffect(() => {
    if (!open) return undefined
    const closeOnOutsidePointer = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function chooseProvider(providerId) {
    onSelectProvider(providerId)
    if (providerId === 'ollama' && !localModels.length) onDiscoverLocal()
  }

  function chooseModel(modelId) {
    onSelectModel(modelId)
    setOpen(false)
  }

  return (
    <div ref={menuRef} className="fl-chat-provider-switcher">
      <button
        type="button"
        className={`fl-chat-provider-trigger ${provider.local ? 'is-local' : ''}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose the provider and model for your next reply"
      >
        <span aria-hidden="true" className="fl-chat-provider-trigger-icon">{provider.icon}</span>
        <span className="fl-chat-provider-trigger-copy">
          <span>{provider.local ? 'Local' : 'Cloud'} · {provider.name.replace('Local ', '')}</span>
          <strong>{provider.model}</strong>
        </span>
        <span aria-hidden="true" className="fl-chat-provider-trigger-chevron">⌄</span>
      </button>

      {open && (
        <section className="fl-chat-provider-menu" role="dialog" aria-label="Choose an AI provider and model">
          <header className="fl-chat-provider-menu-header">
            <div>
              <strong>Choose your AI</strong>
              <span>This applies to your next reply.</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close provider menu">×</button>
          </header>

          {cloudOptions.length > 0 && (
            <section className="fl-chat-provider-group" aria-label="Cloud providers">
              <span className="fl-chat-provider-group-label">Cloud</span>
              <div className="fl-chat-provider-option-list">
                {cloudOptions.map((option) => <ProviderOption key={option.id} option={option} active={provider.id === option.id} onSelect={chooseProvider} />)}
              </div>
            </section>
          )}

          {localOption && (
            <section className="fl-chat-provider-group" aria-label="Local provider">
              <span className="fl-chat-provider-group-label">Local & private</span>
              <div className="fl-chat-provider-option-list">
                <ProviderOption option={localOption} active={provider.id === localOption.id} onSelect={chooseProvider} />
              </div>
            </section>
          )}

          {provider.id && (
            <section className="fl-chat-provider-group fl-chat-provider-model-group" aria-label={`Models for ${provider.name}`}>
              <div className="fl-chat-provider-model-heading">
                <span className="fl-chat-provider-group-label">Model</span>
                {provider.local && <button type="button" className="fl-chat-provider-refresh" onClick={onDiscoverLocal} disabled={discovering}>{discovering ? 'Finding models…' : 'Refresh local models'}</button>}
              </div>
              {provider.local && localFailure && <p className="fl-chat-provider-local-message">FounderLab could not refresh your local models. Your saved model is still selected; try refreshing when Ollama is ready.</p>}
              {modelOptions.length > 0 ? (
                <div className="fl-chat-provider-model-list">
                  {modelOptions.map((model) => (
                    <button key={model.id} type="button" className={provider.modelId === model.id ? 'is-active' : ''} aria-pressed={provider.modelId === model.id} onClick={() => chooseModel(model.id)}>
                      <span>{model.label}</span>
                      {provider.modelId === model.id && <span aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              ) : provider.local ? (
                <button type="button" className="fl-chat-provider-discover" onClick={onDiscoverLocal} disabled={discovering}>{discovering ? 'Looking for local models…' : 'Find local models'}</button>
              ) : null}
            </section>
          )}

          <footer className="fl-chat-provider-menu-footer">
            <button type="button" onClick={() => { setOpen(false); onOpenSettings() }}>Manage providers</button>
            <span style={{ color: C.t3 }}>Your choice is remembered.</span>
          </footer>
        </section>
      )}
    </div>
  )
}
