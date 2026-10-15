import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { ProjectProgress, progressPlot } from '../src/ProjectProgress';
import { api } from '../src/api';
import type { ProgressPoint } from '../src/types';

vi.mock('../src/api', () => ({ api: vi.fn() }));
const points: ProgressPoint[] = [{ date: '2026-10-13', total: 8, completed: 2 }, { date: '2026-10-14', total: 10, completed: 4 }];
beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue({ points, startedAt: points[0].date }));

test.each([280, 390, 960])('renders nonblank real chart geometry at width %i', async (width) => {
  const { container } = render(progressPlot(points, width));
  await waitFor(() => expect(container.querySelectorAll('.recharts-line-curve').length).toBe(2));
  expect(container.querySelector('svg')?.getAttribute('width')).toBe(String(width));
  expect(container.querySelectorAll('path[d*="NaN"]').length).toBe(0);
  expect(container.querySelector('.recharts-line-curve')?.getAttribute('d')).toMatch(/[ML]/);
});
test('shows completion, changes periods and reloads for a new revision', async () => {
  const { rerender } = render(<ProjectProgress projectId="project-a" total={10} completed={4} revision="one" />);
  await screen.findByText('40%'); await waitFor(() => expect(api).toHaveBeenCalledWith('/projects/project-a/progress?days=30'));
  await userEvent.setup().click(screen.getByRole('button', { name: '7 dias' }));
  await waitFor(() => expect(api).toHaveBeenLastCalledWith('/projects/project-a/progress?days=7'));
  expect(screen.getByRole('button', { name: '7 dias' }).getAttribute('aria-pressed')).toBe('true');
  rerender(<ProjectProgress projectId="project-a" total={10} completed={5} revision="two" />);
  expect(screen.getByText('50%')).toBeTruthy(); await waitFor(() => expect(api).toHaveBeenCalledTimes(3));
});
test('renders a visible dot for the first snapshot and handles empty and error states', async () => {
  const { container } = render(progressPlot([points[0]], 390));
  await waitFor(() => expect(container.querySelectorAll('circle.recharts-dot').length).toBeGreaterThan(0)); cleanup();
  vi.mocked(api).mockResolvedValueOnce({ points: [], startedAt: null });
  render(<ProjectProgress projectId="empty" total={0} completed={0} revision="empty" />);
  await screen.findByText('Sem registros no periodo.'); expect(screen.getByText('0%')).toBeTruthy(); cleanup();
  vi.mocked(api).mockRejectedValueOnce(new Error('Sem conexao de teste'));
  render(<ProjectProgress projectId="offline" total={0} completed={0} revision="error" />);
  expect((await screen.findByRole('alert')).textContent).toBe('Sem conexao de teste');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Atualizar grafico' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
