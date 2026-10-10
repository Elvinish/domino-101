import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ReactionReceived } from '@domino/protocol';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';

const reactions = [
  ['thumbs-up', '👍'],
  ['clap', '👏'],
  ['laugh', '😂'],
  ['wow', '😮'],
  ['sad', '😢'],
  ['fire', '🔥'],
] as const;
export function ChatPanel({
  messages,
  reactionEvents,
  unread,
  pending,
  disabled = false,
  error = null,
  onSend,
  onReaction,
  onRead,
  expanded,
}: {
  messages: ChatMessage[];
  reactionEvents: ReactionReceived[];
  unread: number;
  pending: boolean;
  disabled?: boolean;
  error?: MessageKey | null;
  onSend: (text: string) => Promise<boolean>;
  onReaction: (reaction: string) => Promise<boolean>;
  onRead: () => void;
  expanded?: boolean | undefined;
}) {
  const { t, locale } = useI18n();
  const [localOpen, setOpen] = useState(false);
  const open = expanded ?? localOpen;
  const [text, setText] = useState('');
  const [expiredReaction, setExpiredReaction] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const submitting = useRef(false);
  const id = useId();
  const lastId = messages.at(-1)?.messageId;
  const reaction = reactionEvents.at(-1);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );
  function jumpToLatest() {
    atBottom.current = true;
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    onRead();
  }
  useEffect(() => {
    if (open && atBottom.current) {
      if (list.current) list.current.scrollTop = list.current.scrollHeight;
      onRead();
    }
  }, [lastId, open, onRead]);
  useEffect(() => {
    if (!reaction) return;
    const timer = setTimeout(
      () => setExpiredReaction(reaction.reactionId),
      4000,
    );
    return () => clearTimeout(timer);
  }, [reaction]);
  async function submit() {
    const draft = text;
    if (!draft.trim() || pending || disabled || submitting.current) return;
    submitting.current = true;
    try {
      if (await onSend(draft.trim()))
        setText((current) => (current === draft ? '' : current));
    } finally {
      submitting.current = false;
    }
  }
  return (
    <aside
      className={`chat-panel ${open ? 'is-open' : ''}`}
      aria-label={t('chat.title')}
    >
      <button
        className="chat-toggle"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => {
          if (!open) atBottom.current = true;
          setOpen((value) => !value);
        }}
      >
        <span>
          {t('chat.title')} <span aria-hidden="true">{open ? '−' : '+'}</span>
        </span>
        {unread > 0 && (
          <b aria-label={t('chat.unread', { count: unread })}>{unread}</b>
        )}
      </button>
      {open && (
        <div className="chat-body" id={`${id}-body`}>
          <div
            className="chat-messages"
            ref={list}
            tabIndex={0}
            role="region"
            aria-label={t('chat.title')}
            onScroll={() => {
              const element = list.current;
              if (!element) return;
              atBottom.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                40;
              if (atBottom.current) onRead();
            }}
          >
            {messages.length === 0 ? (
              <p className="chat-empty">{t('chat.empty')}</p>
            ) : (
              messages.map((message) => (
                <article className="chat-message" key={message.messageId}>
                  <div className="chat-meta">
                    <strong>{message.sender.displayName}</strong>
                    <time dateTime={new Date(message.timestamp).toISOString()}>
                      {formatter.format(message.timestamp)}
                    </time>
                  </div>
                  <p>{message.text}</p>
                </article>
              ))
            )}
          </div>
          {unread > 0 && (
            <button className="quiet chat-latest" onClick={jumpToLatest}>
              {t('chat.latest')} ({unread})
            </button>
          )}
          <div
            className="chat-reactions"
            role="group"
            aria-label={t('chat.reactions')}
          >
            {reactions.map(([value, emoji]) => (
              <button
                key={value}
                type="button"
                className="reaction-button"
                aria-label={t('chat.sendReaction', {
                  reaction: t(`reaction.${value}`),
                })}
                disabled={pending || disabled}
                onClick={() => void onReaction(value)}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
          <p className="reaction-status" role="status">
            {reaction && reaction.reactionId !== expiredReaction
              ? t('chat.reacted', {
                  name: reaction.sender.displayName,
                  reaction: t(`reaction.${reaction.reaction}`),
                })
              : ''}
          </p>
          {error && (
            <p className="chat-error" role="alert">
              {t(error)}
            </p>
          )}
          {disabled && <p className="chat-help">{t('chat.offline')}</p>}
          <form
            className="chat-compose"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <textarea
              aria-label={t('chat.message')}
              aria-describedby={`${id}-help`}
              maxLength={500}
              rows={2}
              value={text}
              placeholder={t('chat.placeholder')}
              disabled={disabled}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <button
              type="submit"
              className="primary"
              disabled={pending || disabled || !text.trim()}
            >
              {t(pending ? 'chat.sending' : 'chat.send')}
            </button>
          </form>
          <p className="chat-help" id={`${id}-help`}>
            {t('chat.help', { count: text.length })}
          </p>
        </div>
      )}
    </aside>
  );
}
