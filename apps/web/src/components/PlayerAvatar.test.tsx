import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerAvatar } from './PlayerAvatar';
import { avatarStorageKey, prepareAvatar, readAvatar } from '../avatar';

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
    fireEvent.click(screen.getByText('Remove photo'));
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(readAvatar()).toBeUndefined();
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
    render(<PlayerAvatar name="Ayla" editable />);
    fireEvent.change(screen.getByLabelText(/Choose photo/), {
      target: {
        files: [new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Could not save'),
    );
    expect(readAvatar()).toBe('data:image/jpeg;base64,YQ==');
  });
  it('falls back safely when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readAvatar()).toBeUndefined();
    const { container } = render(<PlayerAvatar name="Ayla" editable />);
    expect(container.querySelector('.player-avatar')).toHaveTextContent('A');
  });
});
