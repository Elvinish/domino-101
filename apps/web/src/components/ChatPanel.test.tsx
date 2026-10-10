import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@domino/protocol';
import { ChatPanel } from './ChatPanel';
import { own } from '../test/multiplayer';
function message(index: number): ChatMessage {
  return {
    messageId: String(index),
    sender: { playerId: own.playerId, seat: 0, displayName: 'Əli' },
    text: `Message ${index}`,
    timestamp: 1_700_000_000_000 + index * 1000,
  };
}
function props() {
  return {
    messages: [message(1)],
    reactionEvents: [],
    unread: 1,
    pending: false,
    onRead: vi.fn(),
    onSend: vi.fn().mockResolvedValue(true),
    onReaction: vi.fn().mockResolvedValue(true),
  };
}
afterEach(() => vi.useRealTimers());
describe('chat usability', () => {
  it('preserves the draft in a closed phone sheet and only marks messages read when opened', () => {
    const p = props();
    const view = render(<ChatPanel {...p} expanded={false} />);
    expect(p.onRead).not.toHaveBeenCalled();
    view.rerender(<ChatPanel {...p} expanded />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Unsent draft' },
    });
    p.onRead.mockClear();
    view.rerender(
      <ChatPanel {...p} expanded={false} messages={[message(1), message(2)]} />,
    );
    expect(p.onRead).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    view.rerender(
      <ChatPanel {...p} expanded messages={[message(1), message(2)]} />,
    );
    expect(p.onRead).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('Unsent draft');
  });
  it('starts collapsed with unread count, expands, timestamps, and marks read', () => {
    const p = props();
    render(<ChatPanel {...p} />);
    const toggle = screen.getByRole('button', { name: /Room chat/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Chat message')).not.toBeInTheDocument();
    expect(screen.getByLabelText('1 unread messages')).toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(p.onRead).toHaveBeenCalledTimes(1);
    expect(document.querySelector('time')).toHaveAttribute(
      'datetime',
      new Date(p.messages[0]!.timestamp).toISOString(),
    );
    fireEvent.click(toggle);
    expect(screen.queryByText('Message 1')).not.toBeInTheDocument();
  });
  it('tracks the newest ID after the history reaches 50, without pulling a reader away', () => {
    const p = {
      ...props(),
      messages: Array.from({ length: 50 }, (_, i) => message(i)),
    };
    const view = render(<ChatPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Room chat/ }));
    const list = screen.getByRole('region', { name: 'Room chat' });
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    list.scrollTop = 100;
    fireEvent.scroll(list);
    p.onRead.mockClear();
    view.rerender(
      <ChatPanel {...p} messages={[...p.messages.slice(1), message(50)]} />,
    );
    expect(list.scrollTop).toBe(100);
    expect(p.onRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Jump to latest/ }));
    expect(list.scrollTop).toBe(1000);
    view.rerender(
      <ChatPanel
        {...p}
        messages={[...p.messages.slice(2), message(50), message(51)]}
      />,
    );
    expect(p.onRead).toHaveBeenCalledTimes(2);
  });
  it('sends on Enter, preserves Shift+Enter/IME composition, and renders hostile content as text', async () => {
    const p = props();
    p.messages[0]!.text = '<img src=x onerror=alert(1)>' + 'x'.repeat(300);
    render(<ChatPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Room chat/ }));
    expect(document.querySelector('.chat-message img')).toBeNull();
    expect(screen.getByText(p.messages[0]!.text)).toBeVisible();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: ' hello ' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(p.onSend).not.toHaveBeenCalled();
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(p.onSend).toHaveBeenCalledWith('hello');
    expect(input).toHaveValue('');
  });
  it('keeps drafts and shows feedback on rejection; disables send while pending/offline', async () => {
    const p = props();
    p.onSend.mockResolvedValue(false);
    const view = render(<ChatPanel {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Room chat/ }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hello' },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Send' })),
    );
    view.rerender(<ChatPanel {...p} error="errors.CHAT_RATE_LIMITED" />);
    expect(screen.getByRole('alert')).toHaveTextContent('too quickly');
    expect(screen.getByRole('textbox')).toHaveValue('hello');
    view.rerender(<ChatPanel {...p} pending />);
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    view.rerender(<ChatPanel {...p} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send fire' })).toBeDisabled();
  });
  it('lets reactions fade without adding them to message history', () => {
    vi.useFakeTimers();
    const p = props();
    render(
      <ChatPanel
        {...p}
        reactionEvents={[
          {
            reactionId: 'one',
            sender: message(1).sender,
            reaction: 'fire',
            timestamp: 1,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Room chat/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Əli reacted fire');
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(document.querySelectorAll('.chat-message')).toHaveLength(1);
  });
});
