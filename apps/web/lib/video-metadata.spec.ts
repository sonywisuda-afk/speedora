/** @jest-environment jsdom */
import { readBrowserVideoMetadata } from './video-metadata';

// jsdom implements the <video> element's DOM shape but never actually
// decodes media (no loadedmetadata/error event fires on its own) - each
// test stubs the readonly properties readBrowserVideoMetadata reads and
// manually dispatches the event a real browser would fire once decoding
// finishes, same "simulate the browser API's own contract" approach any
// jsdom-based media test needs.
describe('readBrowserVideoMetadata', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = jest.fn(() => 'blob:fake-url');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  it('resolves duration/width/height/size/mimeType once loadedmetadata fires', async () => {
    const file = new File(['x'.repeat(1024)], 'clip.mp4', { type: 'video/mp4' });

    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const createElementSpy = jest.spyOn(document, 'createElement');

    const promise = readBrowserVideoMetadata(file);

    const videoEl = createElementSpy.mock.results.find((r) => r.value instanceof HTMLVideoElement)
      ?.value as HTMLVideoElement;
    Object.defineProperty(videoEl, 'duration', { value: 42.5, configurable: true });
    Object.defineProperty(videoEl, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(videoEl, 'videoHeight', { value: 1080, configurable: true });
    videoEl.dispatchEvent(new Event('loadedmetadata'));

    await expect(promise).resolves.toEqual({
      durationSeconds: 42.5,
      width: 1920,
      height: 1080,
      sizeBytes: 1024,
      mimeType: 'video/mp4',
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });

  it('rejects when the browser cannot decode the file', async () => {
    const file = new File(['x'], 'broken.mp4', { type: 'video/mp4' });

    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const createElementSpy = jest.spyOn(document, 'createElement');

    const promise = readBrowserVideoMetadata(file);

    const videoEl = createElementSpy.mock.results.find((r) => r.value instanceof HTMLVideoElement)
      ?.value as HTMLVideoElement;
    videoEl.dispatchEvent(new Event('error'));

    await expect(promise).rejects.toThrow('Browser tidak dapat membaca metadata video ini.');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
