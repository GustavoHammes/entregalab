import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Auth } from '../src/Auth';
import svg from '../kanban.svg?raw';
import kanbanIcon from '../kanban.svg';
import html from '../index.html?raw';

test('uses a visible self-contained SVG as the favicon and login brand', async () => {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(parsed.querySelector('parsererror')).toBeNull(); expect(parsed.documentElement.getAttribute('viewBox')).toBe('0 0 32 32');
  expect(parsed.querySelectorAll('rect').length).toBe(4); expect(parsed.querySelector('script, foreignObject')).toBeNull();
  expect(html).toMatch(/rel="icon"[^>]+kanban\.svg/);
  const { container } = render(<Auth onLogin={() => {}} />);
  expect(container.querySelector('img.brand-icon')?.getAttribute('src')).toBe(kanbanIcon);
});
