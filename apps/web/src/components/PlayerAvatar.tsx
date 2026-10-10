import { useCallback, useEffect, useRef, useState } from 'react';
import { avatarStorageKey, prepareAvatar, readAvatar } from '../avatar';
import { useI18n } from '../i18n';

/** imageUrl is an adapter point for a future profile source, separate from game DTOs. */
export function PlayerAvatar({
  name,
  editable = false,
  imageUrl,
}: {
  name: string;
  editable?: boolean;
  imageUrl?: string | undefined;
}) {
  const { t } = useI18n();
  const [localImage, setLocalImage] = useState(() =>
    editable ? readAvatar() : undefined,
  );
  const [failedImage, setFailedImage] = useState<string>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const popup = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback((restoreFocus = false) => {
    generation.current++;
    setBusy(false);
    setError(false);
    if (input.current) input.current.value = '';
    if (popup.current) {
      popup.current.open = false;
      if (restoreFocus)
        popup.current.querySelector('summary')?.focus({ preventScroll: true });
    }
  }, []);
  useEffect(() => {
    if (!editable) return;
    const outside = (event: PointerEvent) => {
      if (
        popup.current?.open &&
        event.target instanceof Node &&
        !popup.current.contains(event.target)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (popup.current?.open && event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [editable, close]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const source = editable ? (localImage ?? imageUrl) : imageUrl;
  const face =
    source && source !== failedImage ? (
      <img src={source} alt="" onError={() => setFailedImage(source)} />
    ) : (
      <span aria-hidden="true">
        {name.trim().slice(0, 1).toLocaleUpperCase() || '+'}
      </span>
    );

  async function change(file?: File) {
    if (!file) return;
    const current = ++generation.current;
    setBusy(true);
    setError(false);
    try {
      const value = await prepareAvatar(file);
      if (current !== generation.current) return;
      localStorage.setItem(avatarStorageKey, value);
      setLocalImage(value);
      setFailedImage(undefined);
      close(true);
    } catch {
      if (current === generation.current) setError(true);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  if (!editable)
    return (
      <span className="player-avatar" aria-hidden="true">
        {face}
      </span>
    );
  return (
    <details
      className="avatar-settings"
      ref={popup}
      onToggle={() => {
        if (!popup.current?.open) close();
      }}
    >
      <summary
        className="player-avatar"
        aria-label={t('avatar.change')}
        onClick={(event) => {
          if (popup.current?.open) {
            event.preventDefault();
            close(true);
          }
        }}
      >
        {face}
      </summary>
      <div className="avatar-popover">
        <p>{t('avatar.local')}</p>
        <label>
          {t('avatar.upload')}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              void change(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
        </label>
        {localImage && (
          <button
            type="button"
            className="quiet"
            onClick={() => {
              generation.current++;
              setBusy(false);
              try {
                localStorage.removeItem(avatarStorageKey);
                setLocalImage(undefined);
                close(true);
              } catch {
                setError(true);
              }
            }}
          >
            {t('avatar.remove')}
          </button>
        )}
        <button type="button" className="quiet" onClick={() => close(true)}>
          {t('game.cancel')}
        </button>
        <span role="status">
          {error ? t('avatar.error') : busy ? t('avatar.loading') : ''}
        </span>
      </div>
    </details>
  );
}
