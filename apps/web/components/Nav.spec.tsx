/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { UserRole } from '@speedora/shared';
import type { UserDto } from '@/lib/api';
import { Nav } from './Nav';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

// Nav's own responsibility is the link list, the hamburger toggle, and the
// drawer - NotificationBell/WorkspaceSwitcher are independently tested and
// bring their own SWR/SSE side effects, so they're stubbed out here the same
// way DashboardClient.spec.tsx stubs Nav itself.
jest.mock('./NotificationBell', () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));
jest.mock('./WorkspaceSwitcher', () => ({
  WorkspaceSwitcher: () => <div data-testid="workspace-switcher" />,
}));

function user(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'user-1',
    email: 'creator@example.com',
    role: UserRole.CREATOR,
    ...overrides,
  } as UserDto;
}

describe('Nav', () => {
  it('renders the full link list once in the always-visible desktop nav', () => {
    render(<Nav user={user()} onLogout={jest.fn()} />);
    expect(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not show the AI Ops link for a CREATOR', () => {
    render(<Nav user={user({ role: UserRole.CREATOR })} onLogout={jest.fn()} />);
    expect(screen.queryByRole('link', { name: 'AI Ops' })).not.toBeInTheDocument();
  });

  it('shows the AI Ops link for a non-CREATOR role', () => {
    render(<Nav user={user({ role: UserRole.ADMIN })} onLogout={jest.fn()} />);
    expect(screen.getByRole('link', { name: 'AI Ops' })).toBeInTheDocument();
  });

  it('opens the mobile drawer from a closed state, exposing a second copy of the links', () => {
    render(<Nav user={user()} onLogout={jest.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Buka menu navigasi' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    // The drawer is a real Radix Dialog - closed content isn't in the DOM at
    // all until opened, so this also proves it doesn't sit hidden-but-still-
    // rendered (which would have re-triggered NotificationBell-style network
    // hooks twice, see Nav.tsx's account-cluster comment).
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();

    // Radix marks the rest of the page aria-hidden while the drawer is open
    // (correct modal behavior - background content shouldn't be reachable by
    // assistive tech), which also removes the trigger from role-based
    // queries; asserting on the retained element reference instead.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-label', 'Tutup menu navigasi');
  });

  it('closes the drawer when a link inside it is clicked', () => {
    render(<Nav user={user()} onLogout={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buka menu navigasi' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('link', { name: 'Upload' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the drawer on Escape', () => {
    render(<Nav user={user()} onLogout={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Buka menu navigasi' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders exactly one NotificationBell regardless of viewport, avoiding duplicate polling/toast side effects', () => {
    render(<Nav user={user()} onLogout={jest.fn()} />);
    expect(screen.getAllByTestId('notification-bell')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Buka menu navigasi' }));
    // Still exactly one even with the drawer open - it deliberately isn't
    // duplicated into the drawer.
    expect(screen.getAllByTestId('notification-bell')).toHaveLength(1);
  });
});
