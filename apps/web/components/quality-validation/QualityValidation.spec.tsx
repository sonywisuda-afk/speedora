/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VideoWithClipsDto } from '@/lib/api';
import { QualityValidation } from './QualityValidation';

// Only the fields this component actually reads are set for real - every
// other Video field is irrelevant here, same "minimal partial fixture cast"
// shortcut this repo's backend spec files already use for mocks that don't
// need a full row.
function video(overrides: Partial<VideoWithClipsDto>): VideoWithClipsDto {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    videoBitrate: 4_000_000,
    audioChannels: 2,
    durationSeconds: 300,
    validationReport: { errors: [], warnings: [], info: [] },
    ...overrides,
  } as VideoWithClipsDto;
}

describe('QualityValidation', () => {
  it('shows a clean state and real probed values when there are no warnings', () => {
    render(<QualityValidation video={video({})} onContinue={jest.fn()} onBack={jest.fn()} />);

    expect(screen.getByText('Video siap diproses.')).toBeInTheDocument();
    expect(screen.getByText('1920×1080')).toBeInTheDocument();
    expect(screen.getByText('30 fps')).toBeInTheDocument();
    expect(screen.getByText('Stereo')).toBeInTheDocument();
  });

  it('flags each warning with its message and a non-blocking summary', () => {
    render(
      <QualityValidation
        video={video({
          height: 360,
          audioChannels: 1,
          validationReport: {
            errors: [],
            warnings: [
              { id: 'low-resolution', message: 'Resolusi rendah (640x360px).' },
              { id: 'mono-audio', message: 'Audio mono (bukan stereo).' },
            ],
            info: [],
          },
        })}
        onContinue={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    expect(
      screen.getByText('2 hal perlu diperhatikan - kamu tetap bisa melanjutkan.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Resolusi rendah (640x360px).')).toBeInTheDocument();
    expect(screen.getByText('Audio mono (bukan stereo).')).toBeInTheDocument();
  });

  it('never disables Continue - Warning-tier findings are non-blocking by design', () => {
    const onContinue = jest.fn();
    render(
      <QualityValidation
        video={video({
          validationReport: {
            errors: [],
            warnings: [{ id: 'mono-audio', message: 'Audio mono (bukan stereo).' }],
            info: [],
          },
        })}
        onContinue={onContinue}
        onBack={jest.fn()}
      />,
    );

    const continueButton = screen.getByRole('button', { name: 'Lanjutkan ke Pengaturan' });
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('calls onBack when Kembali is clicked', () => {
    const onBack = jest.fn();
    render(<QualityValidation video={video({})} onContinue={jest.fn()} onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kembali' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
