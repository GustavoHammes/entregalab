import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { EmailPreferences } from '../src/EmailPreferences';
import { api, json } from '../src/api';
import type { EmailSettings } from '../src/types';

vi.mock('../src/api', () => ({ api: vi.fn(), json: (method: string, body: unknown) => ({ method, body: JSON.stringify(body) }) }));
const settings: EmailSettings = { email: 'fixture@example.com', isDemo: false, verified: false, emailEnabled: false, available: false,
  enabled: false, isAdmin: false, delivery: { pending: 0, failed: 0, sent: 0 } };
beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue(settings));
test('does not allow verification or email opt-in while unavailable or unverified', async () => {
  render(<EmailPreferences />); await screen.findByText('Confirmacao pendente');
  expect((screen.getByRole('button', { name: 'Enviar confirmacao' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
});
test('keeps demonstration accounts from showing any email send controls', async () => {
  vi.mocked(api).mockResolvedValue({ ...settings, isDemo: true }); render(<EmailPreferences />);
  await screen.findByText('Envio desativado para contas de teste.'); expect(screen.queryByRole('checkbox')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
});
test('consumes a verification link only after the explicit confirmation command', async () => {
  window.location.hash = 'notifications?verify=test-verification-token';
  render(<EmailPreferences />); const confirm = await screen.findByRole('button', { name: 'Confirmar email' });
  expect(api).toHaveBeenCalledTimes(1); await userEvent.setup().click(confirm);
  await waitFor(() => expect(api).toHaveBeenCalledWith('/email/verify', json('POST', { token: 'test-verification-token' })));
  await screen.findByText('Endereco confirmado.'); expect(window.location.hash).toBe('#notifications');
});
test('requires explicit opt-in after the address is verified', async () => {
  vi.mocked(api).mockResolvedValue({ ...settings, available: true, verified: true }); render(<EmailPreferences />);
  await screen.findByText('Endereco confirmado'); await userEvent.setup().click(screen.getByRole('checkbox'));
  await waitFor(() => expect(api).toHaveBeenCalledWith('/notifications/preferences', json('PATCH', { emailEnabled: true })));
});
