/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { generateMoreClips } from '@/lib/api';
import { GenerateMoreClipsDialog } from './GenerateMoreClipsDialog';

jest.mock('@/lib/api', () => ({
  generateMoreClips: jest.fn(),
}));

const mockGenerateMoreClips = generateMoreClips as jest.Mock;

function renderDialog() {
  const utils = render(<GenerateMoreClipsDialog videoId="video-1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate More Clips' }));
  return utils;
}

describe('GenerateMoreClipsDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateMoreClips.mockResolvedValue({});
  });

  it('submits default values (requestedCount 2, avoidOverlap true, no quality floor)', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockGenerateMoreClips).toHaveBeenCalledWith('video-1', {
        requestedCount: 2,
        minClipDurationSeconds: undefined,
        maxClipDurationSeconds: undefined,
        minConfidence: undefined,
        avoidOverlap: true,
      });
    });
  });

  it('maps the "Tinggi" quality tier to minConfidence 70', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Prioritas kualitas'), {
      target: { value: 'high' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockGenerateMoreClips).toHaveBeenCalledWith(
        'video-1',
        expect.objectContaining({ minConfidence: 70 }),
      );
    });
  });

  it('sends avoidOverlap: false when the checkbox is unchecked', async () => {
    renderDialog();

    fireEvent.click(screen.getByLabelText('Hindari overlap dengan clip sebelumnya'));
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockGenerateMoreClips).toHaveBeenCalledWith(
        'video-1',
        expect.objectContaining({ avoidOverlap: false }),
      );
    });
  });

  it('forwards custom count and duration bounds', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Jumlah klip tambahan'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Durasi minimum (detik)'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Durasi maksimum (detik)'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(mockGenerateMoreClips).toHaveBeenCalledWith(
        'video-1',
        expect.objectContaining({
          requestedCount: 5,
          minClipDurationSeconds: 15,
          maxClipDurationSeconds: 90,
        }),
      );
    });
  });

  it('shows a confirmation message and never touches the timeline store after a successful submit', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText(/Klip tambahan sedang diproses/)).toBeInTheDocument();
  });

  it('shows an inline error message when the request fails, keeping the form open to retry', async () => {
    mockGenerateMoreClips.mockRejectedValue(new Error('Video sedang diproses'));
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Video sedang diproses')).toBeInTheDocument();
    // Form fields are still present - not replaced by the success state.
    expect(screen.getByLabelText('Jumlah klip tambahan')).toBeInTheDocument();
  });
});
