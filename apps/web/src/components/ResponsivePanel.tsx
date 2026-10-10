import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n';

/** Keep content mounted: closing the sheet must not disconnect room voice. */
export function ResponsivePanel({
  mobile,
  kind,
  label,
  badge = 0,
  onOpenChange,
  children,
}: {
  mobile: boolean;
  kind: 'settings' | 'chat' | 'voice';
  label: string;
  badge?: number;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasMobile = useRef(mobile);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    // Leaving phone mode also exits the browser's modal top layer.
    if (!mobile && wasMobile.current) {
      dialog.close();
      dialog.open = true;
    }
    wasMobile.current = mobile;
    if (!mobile) return;
    const viewport = window.visualViewport;
    const measure = () => {
      dialog.style.setProperty(
        '--sheet-height',
        `${viewport?.height ?? innerHeight}px`,
      );
      dialog.style.setProperty('--sheet-top', `${viewport?.offsetTop ?? 0}px`);
    };
    measure();
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, [mobile]);
  return (
    <div className={`responsive-panel ${mobile ? 'is-mobile' : ''}`}>
      {mobile && (
        <button
          ref={trigger}
          className={`quiet mobile-tool mobile-tool--${kind}`}
          aria-label={label}
          aria-haspopup="dialog"
          aria-controls={id}
          onClick={() => {
            ref.current?.showModal();
            onOpenChange?.(true);
          }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {kind === 'chat' ? (
              <path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z" />
            ) : kind === 'voice' ? (
              <>
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8" />
              </>
            ) : (
              <path d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
          {badge > 0 && (
            <b aria-label={t('chat.unread', { count: badge })}>{badge}</b>
          )}
        </button>
      )}
      <dialog
        ref={ref}
        id={id}
        open={!mobile}
        aria-label={mobile ? label : undefined}
        role={mobile ? 'dialog' : 'presentation'}
        onClose={() => {
          onOpenChange?.(false);
          if (mobile) trigger.current?.focus();
        }}
        onClick={(event) => {
          if (!mobile || event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            event.currentTarget.close();
        }}
      >
        {mobile && (
          <div className="sheet-heading">
            <h2>{label}</h2>
            <button
              onClick={() => ref.current?.close()}
              aria-label={t('mobile.close')}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </dialog>
    </div>
  );
}
