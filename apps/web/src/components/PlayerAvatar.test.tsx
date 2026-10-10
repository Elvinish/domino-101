import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerAvatar } from './PlayerAvatar';
import { avatarStorageKey, prepareAvatar, readAvatar } from '../avatar';
import * as avatar from '../avatar';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('local avatar presentation', () => {
  it('uses initials for missing and failed profile images', () => {
    const { container } = render(
      <PlayerAvatar name="Ayla" imageUrl="/missing-photo.png" />,
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.player-avatar')).toHaveTextContent('A');
    expect(container.querySelector('details')).toBeNull();
  });
  it('only uses the local photo for the current user and removes it', () => {
    localStorage.setItem(avatarStorageKey, 'data:image/jpeg;base64,YQ==');
    const { container } = render(
      <>
        <PlayerAvatar name="Ayla" editable />
        <PlayerAvatar name="Murad" />
      </>,
    );
    expect(container.querySelectorAll('img')).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('Change your avatar'));
    expect(container.querySelector('details')).toHaveAttribute('open');
    fireEvent.click(screen.getByText('Remove photo'));
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(readAvatar()).toBeUndefined();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Change your avatar')).toHaveFocus();
  });
  it('rejects active formats, oversized files and malformed stored values', async () => {
    await expect(
      prepareAvatar(
        new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }),
      ),
    ).rejects.toThrow();
    await expect(
      prepareAvatar(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'photo.png', {
          type: 'image/png',
        }),
      ),
    ).rejects.toThrow();
    localStorage.setItem(avatarStorageKey, 'https://example.com/tracker.png');
    expect(readAvatar()).toBeUndefined();
    localStorage.setItem(avatarStorageKey, 'data:image/svg+xml;base64,YQ==');
    expect(readAvatar()).toBeUndefined();
  });
  it('reports upload failure without changing an existing avatar', async () => {
    localStorage.setItem(avatarStorageKey, 'data:image/jpeg;base64,YQ==');
    const { container } = render(<PlayerAvatar name="Ayla" editable />);
    fireEvent.click(screen.getByLabelText('Change your avatar'));
    fireEvent.change(screen.getByLabelText(/Choose photo/), {
      target: {
        files: [new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Could not save'),
    );
    expect(readAvatar()).toBe('data:image/jpeg;base64,YQ==');
    expect(container.querySelector('details')).toHaveAttribute('open');
  });
  it('updates the face, clears the input and closes only after saving succeeds', async () => {
    let finish!: (value: string) => void;
    vi.spyOn(avatar, 'prepareAvatar').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { container } = render(<PlayerAvatar name="Ayla" editable />);
    fireEvent.click(screen.getByLabelText('Change your avatar'));
    const input = screen.getByLabelText(/Choose photo/);
    fireEvent.change(input, {
      target: {
        files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
      },
    });
    expect(container.querySelector('details')).toHaveAttribute('open');
    expect(input).toBeDisabled();
    await act(async () => finish('data:image/jpeg;base64,Yg=='));
    expect(container.querySelector('.player-avatar img')).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,Yg==',
    );
    expect(readAvatar()).toBe('data:image/jpeg;base64,Yg==');
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(input).toHaveValue('');
    expect(input).not.toBeDisabled();
    expect(screen.getByLabelText('Change your avatar')).toHaveFocus();
  });
  it.each(['upload', 'remove'])(
    'keeps the popup and existing face on %s storage failure',
    async (action) => {
      localStorage.setItem(avatarStorageKey, 'data:image/jpeg;base64,YQ==');
      vi.spyOn(avatar, 'prepareAvatar').mockResolvedValue(
        'data:image/jpeg;base64,Yg==',
      );
      vi.spyOn(
        Storage.prototype,
        action === 'upload' ? 'setItem' : 'removeItem',
      ).mockImplementation(() => {
        throw new Error('blocked');
      });
      const { container } = render(<PlayerAvatar name="Ayla" editable />);
      fireEvent.click(screen.getByLabelText('Change your avatar'));
      if (action === 'remove')
        fireEvent.click(screen.getByText('Remove photo'));
      else
        fireEvent.change(screen.getByLabelText(/Choose photo/), {
          target: {
            files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
          },
        });
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Could not save'),
      );
      expect(container.querySelector('details')).toHaveAttribute('open');
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,YQ==',
      );
    },
  );
  it.each(['Escape', 'outside', 'Cancel', 'avatar trigger'])(
    'cancels pending photo work on %s without changing the saved avatar',
    async (action) => {
      let finish!: (value: string) => void;
      vi.spyOn(avatar, 'prepareAvatar').mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const { container } = render(<PlayerAvatar name="Ayla" editable />);
      const trigger = screen.getByLabelText('Change your avatar');
      fireEvent.click(trigger);
      fireEvent.change(screen.getByLabelText(/Choose photo/), {
        target: {
          files: [new File(['photo'], 'photo.png', { type: 'image/png' })],
        },
      });
      if (action === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
      else if (action === 'outside') fireEvent.pointerDown(document.body);
      else if (action === 'avatar trigger') fireEvent.click(trigger);
      else fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(container.querySelector('details')).not.toHaveAttribute('open');
      await act(async () => finish('data:image/jpeg;base64,Yg=='));
      expect(readAvatar()).toBeUndefined();
      expect(container.querySelector('img')).toBeNull();
      fireEvent.click(trigger);
      expect(container.querySelector('details')).toHaveAttribute('open');
      expect(screen.getByLabelText(/Choose photo/)).not.toBeDisabled();
    },
  );
  it('falls back safely when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readAvatar()).toBeUndefined();
    const { container } = render(<PlayerAvatar name="Ayla" editable />);
    expect(container.querySelector('.player-avatar')).toHaveTextContent('A');
  });
});
