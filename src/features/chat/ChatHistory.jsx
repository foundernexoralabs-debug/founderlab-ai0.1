import { C } from '@/app/theme'
import { Spinner } from '@/components/ui/Primitives'
import { filterConversations, groupConversationsByRecency } from './chatUtils'

const iconButton = {
  background: 'transparent',
  border: 'none',
  color: C.t3,
  cursor: 'pointer',
  padding: 4,
  borderRadius: 6,
  fontFamily: 'inherit',
  lineHeight: 1,
}

export function ChatHistory({
  conversations,
  activeId,
  loading,
  open,
  search,
  renamingId,
  renameValue,
  onSearch,
  onSelect,
  onNewChat,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onTogglePin,
  onDelete,
}) {
  const filtered = filterConversations(conversations, search)
  const groups = groupConversationsByRecency(filtered)

  return (
    <aside className={`fl-chat-history ${open ? '' : 'is-closed'}`} aria-label="Chat history">
      <div style={{ padding: 14, borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" onClick={onNewChat} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          padding: '10px 12px', borderRadius: 11,
          background: `linear-gradient(135deg, ${C.accent}, #8b5cf6)`,
          border: 'none', color: '#fff', cursor: 'pointer',
          fontSize: 13, fontWeight: 650, fontFamily: 'inherit',
          boxShadow: '0 5px 18px rgba(99,102,241,.26)',
        }}>
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 0 }}>+</span>
          New chat
        </button>
        <label style={{ position: 'relative', display: 'block' }}>
          <span className="fl-chat-sr-only">Search conversations</span>
          <span aria-hidden="true" style={{ position: 'absolute', left: 11, top: 8, color: C.t3, fontSize: 13 }}>⌕</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search chats"
            style={{ width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 9, color: C.t1, fontSize: 12, padding: '8px 10px 8px 28px', fontFamily: 'inherit', outline: 'none' }}
            onFocus={(event) => { event.currentTarget.style.borderColor = C.borderFocus }}
            onBlur={(event) => { event.currentTarget.style.borderColor = C.border }}
          />
        </label>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 8px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 14px', color: C.t3, fontSize: 13, lineHeight: 1.5 }}>
            {search ? 'No conversations match that search.' : 'Your conversations will appear here.'}
          </div>
        ) : groups.map(([label, entries]) => (
          <section key={label} aria-label={label} style={{ marginBottom: 15 }}>
            <h2 style={{ margin: '0 8px 6px', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.t3, fontWeight: 700 }}>{label}</h2>
            {entries.map((conversation) => {
              const active = activeId === conversation.id
              const renaming = renamingId === conversation.id
              return (
                <div key={conversation.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, borderRadius: 9, background: active ? C.accentM : 'transparent', border: `1px solid ${active ? C.borderFocus : 'transparent'}` }}>
                  {renaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => onRenameChange(event.target.value)}
                      onBlur={() => onRenameCommit(conversation.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') onRenameCommit(conversation.id)
                        if (event.key === 'Escape') onRenameCancel()
                      }}
                      aria-label="Conversation name"
                      style={{ flex: 1, minWidth: 0, margin: 5, background: C.bg, border: `1px solid ${C.accent}`, borderRadius: 6, padding: '5px 7px', color: C.t1, fontSize: 12, outline: 'none', fontFamily: 'inherit' }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      aria-current={active ? 'page' : undefined}
                      style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', color: active ? C.t1 : C.t2, cursor: 'pointer', padding: '9px 3px 9px 9px', textAlign: 'left', fontFamily: 'inherit', fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conversation.pinned && <span aria-label="Pinned" style={{ color: C.accent, marginRight: 5 }}>⌖</span>}
                      {conversation.title || 'Untitled chat'}
                    </button>
                  )}
                  {!renaming && (
                    <div style={{ display: 'flex', alignItems: 'center', paddingRight: 5 }}>
                      <button type="button" onClick={() => onTogglePin(conversation.id)} title={conversation.pinned ? 'Unpin chat' : 'Pin chat'} aria-label={conversation.pinned ? 'Unpin chat' : 'Pin chat'} style={{ ...iconButton, color: conversation.pinned ? C.accent : C.t3 }}>⌖</button>
                      <button type="button" onClick={() => onRenameStart(conversation)} title="Rename chat" aria-label="Rename chat" style={iconButton}>✎</button>
                      <button type="button" onClick={() => onDelete(conversation.id)} title="Delete chat" aria-label="Delete chat" style={{ ...iconButton, fontSize: 16 }}>×</button>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </aside>
  )
}
