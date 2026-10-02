import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { errorCodeSchema } from '@domino/protocol';
import { App } from '../app/App';
import { fakeClient, roomId } from '../test/multiplayer';
import {
  isLocale,
  languageKey,
  readLocale,
  resources,
  translate,
} from './index';
import type { Locale, MessageKey } from './index';

describe('localization resources and persistence', () => {
  it('has matching keys, interpolation parameters and every structured error in all languages', () => {
    for (const locale of ['ru', 'az'] as const) {
      expect(Object.keys(resources[locale]).sort()).toEqual(
        Object.keys(resources.en).sort(),
      );
      for (const key of Object.keys(resources.en) as MessageKey[]) {
        expect(resources[locale][key].match(/\{\w+\}/g)?.sort() ?? []).toEqual(
          resources.en[key].match(/\{\w+\}/g)?.sort() ?? [],
        );
      }
    }
    for (const code of errorCodeSchema.options)
      for (const locale of ['ru', 'az', 'en'] as const)
        expect(resources[locale][`errors.${code}`]).toBeTruthy();
  });
  it.each([
    ['en', 'Take a seat', 'This table already has four players.'],
    ['ru', 'Занимайте место', 'За этим столом уже четверо игроков.'],
    ['az', 'Yerini tut', 'Bu masada artıq dörd oyunçu var.'],
  ] as const)(
    'renders %s entry, controls and server errors',
    async (locale, heading, error) => {
      localStorage.setItem(languageKey, locale);
      const f = fakeClient();
      render(
        <MemoryRouter initialEntries={[`/room/${roomId}`]}>
          <App client={f.client} />
        </MemoryRouter>,
      );
      expect(document.documentElement.lang).toBe(locale);
      expect(
        screen.getByRole('heading', {
          name: translate(locale, 'entry.awaiting'),
        }),
      ).toBeVisible();
      expect(translate(locale, 'entry.seat')).toBe(heading);
      fireEvent.change(screen.getByLabelText(translate(locale, 'entry.name')), {
        target: { value: 'Əli' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: translate(locale, 'entry.join') }),
      );
      await act(async () => f.ack({ ok: false, error: { code: 'ROOM_FULL' } }));
      expect(screen.getByRole('alert')).toHaveTextContent(error);
      expect(
        screen.getByLabelText(translate(locale, 'entry.name')),
      ).toHaveValue('Əli');
    },
  );
  it('switches existing errors without reload and restores a saved selection on remount', async () => {
    const f = fakeClient();
    const view = render(
      <MemoryRouter>
        <App client={f.client} />
      </MemoryRouter>,
    );
    await act(async () => {
      await f.client.join('invalid', 'Name');
    });
    for (const locale of ['ru', 'az', 'en'] as Locale[]) {
      fireEvent.change(screen.getByRole('combobox'), {
        target: { value: locale },
      });
      expect(
        screen.getByRole('heading', { name: translate(locale, 'entry.seat') }),
      ).toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent(
        translate(locale, 'errors.INVALID_PAYLOAD'),
      );
      expect(localStorage.getItem(languageKey)).toBe(locale);
    }
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'az' } });
    view.unmount();
    render(
      <MemoryRouter>
        <App client={fakeClient().client} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('combobox')).toHaveValue('az');
  });
  it('falls back safely for denied/corrupt preferences and unknown messages', () => {
    expect(isLocale('xx')).toBe(false);
    localStorage.setItem(languageKey, 'unknown');
    expect(readLocale()).toBe('en');
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    expect(readLocale()).toBe('en');
    spy.mockRestore();
    expect(translate('ru', '<internal secret>' as MessageKey)).toBe(
      resources.ru['errors.INTERNAL_ERROR'],
    );
    expect(
      translate('az', 'game.playerTurn', { name: '{team}<b>Əli</b>' }),
    ).toBe('Gediş növbəsi: {team}<b>Əli</b>');
  });
});
