// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EpisodeCommunity from '../src/components/EpisodeCommunity';

const community = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  account: { ready: true, account: null, profile: null } as {
    ready: boolean;
    account: null | { id: string };
    profile: null | { id: string; name: string; avatar: 'amber' };
  },
}));

vi.mock('../src/account/api', () => ({
  episodeComments: community.list,
  createEpisodeComment: community.create,
  updateEpisodeComment: community.update,
  deleteEpisodeComment: community.remove,
}));

vi.mock('../src/account/AccountProvider', () => ({
  useAccount: () => community.account,
}));

const emptyPage = { items: [], total: 0, page: 1, pageSize: 12, pages: 0 };

describe('EpisodeCommunity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    community.account = { ready: true, account: null, profile: null };
    community.list.mockResolvedValue(emptyPage);
  });

  it('keeps public reading available while clearly requiring sign-in to post', async () => {
    render(<MemoryRouter><EpisodeCommunity episodeId="ep-1" /></MemoryRouter>);
    expect(await screen.findByText('No comments yet')).toBeTruthy();
    expect(screen.getByText('Start the conversation for this episode.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login');
    expect(community.list).toHaveBeenCalledWith('ep-1', { page: 1, pageSize: 12 }, expect.any(AbortSignal));
  });

  it('posts through the active profile and refreshes the public thread', async () => {
    community.account = {
      ready: true,
      account: { id: 'account-1' },
      profile: { id: 'profile-1', name: 'Mina', avatar: 'amber' },
    };
    community.list
      .mockResolvedValueOnce(emptyPage)
      .mockResolvedValueOnce({
        items: [{
          id: 'comment-1', episodeId: 'ep-1', author: { name: 'Mina', avatar: 'amber' },
          body: 'That ending was excellent.', revision: 1,
          createdAt: '2026-09-13T00:00:00.000Z', updatedAt: '2026-09-13T00:00:00.000Z',
          ownedByViewer: true,
        }],
        total: 1, page: 1, pageSize: 12, pages: 1,
      });
    community.create.mockResolvedValue({ comment: { id: 'comment-1' } });

    render(<MemoryRouter><EpisodeCommunity episodeId="ep-1" /></MemoryRouter>);
    await screen.findByText('No comments yet');
    fireEvent.change(screen.getByLabelText('Comment as Mina'), { target: { value: 'That ending was excellent.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => expect(community.create).toHaveBeenCalledWith('ep-1', 'profile-1', 'That ending was excellent.'));
    expect(await screen.findByText('That ending was excellent.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });
});
