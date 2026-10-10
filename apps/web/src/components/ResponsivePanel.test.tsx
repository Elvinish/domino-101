import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ResponsivePanel } from './ResponsivePanel';

it('keeps a voice session mounted when closing sheets and switching to desktop', () => {
  const mounted = vi.fn();
  const disposed = vi.fn();
  const onOpenChange = vi.fn();
  function Session() {
    useEffect(() => {
      mounted();
      return disposed;
    }, []);
    return <input aria-label="Session state" defaultValue="Connected" />;
  }
  const view = render(
    <ResponsivePanel
      mobile
      kind="voice"
      label="Voice"
      onOpenChange={onOpenChange}
    >
      <Session />
    </ResponsivePanel>,
  );
  const dialog = screen.getByRole('dialog', {
    hidden: true,
  }) as HTMLDialogElement;
  // jsdom has no native modal top layer; browser tests exercise real dialogs.
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
    dialog.dispatchEvent(new Event('close'));
  };
  fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Microphone enabled' },
  });
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole('button', { name: 'Voice' })).toHaveFocus();
  expect(disposed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Voice' }));
  view.rerender(
    <ResponsivePanel
      mobile={false}
      kind="voice"
      label="Voice"
      onOpenChange={onOpenChange}
    >
      <Session />
    </ResponsivePanel>,
  );
  expect(screen.getByRole('textbox')).toHaveValue('Microphone enabled');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(disposed).not.toHaveBeenCalled();
  view.unmount();
  expect(disposed).toHaveBeenCalledTimes(1);
});
