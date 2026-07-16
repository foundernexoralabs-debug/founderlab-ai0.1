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
      <div className="fl-chat-history-header">
        <button type="button" onClick={onNewChat} className="fl-chat-new-conversation">
          <span aria-hidden="true" style={{ fontSize: 17, lineHeight: 0 }}>+</span>
          New chat
        </button>
        <label className="fl-chat-history-search">
          <span className="fl-chat-sr-only">Search conversations</span>
          <span aria-hidden="true">⌕</span>
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search chats"
          />
        </label>
      </div>

      <div className="fl-chat-history-list">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : filtered.length === 0 ? (
          <div className="fl-chat-history-empty">
            {search ? 'No conversations match that search.' : 'Your conversations will appear here.'}
          </div>
        ) : groups.map(([label, entries]) => (
          <section key={label} aria-label={label} className="fl-chat-history-group">
            <h2>{label}</h2>
            {entries.map((conversation) => {
              const active = activeId === conversation.id
              const renaming = renamingId === conversation.id
              return (
                <div key={conversation.id} className={`fl-chat-history-item ${active ? 'is-active' : ''}`}>
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
                      className="fl-chat-history-rename"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(conversation.id)}
                      aria-current={active ? 'page' : undefined}
                      className="fl-chat-history-select">
                      {conversation.pinned && <span aria-label="Pinned" style={{ color: C.accent, marginRight: 5 }}>⌖</span>}
                      {conversation.title || 'Untitled chat'}
                    </button>
                  )}
                  {!renaming && (
                    <div className="fl-chat-history-actions">
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
