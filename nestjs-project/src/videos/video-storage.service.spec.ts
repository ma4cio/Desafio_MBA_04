import { InvalidRangeException } from './video.exceptions';
import { VideoStorageService } from './video-storage.service';

describe('VideoStorageService byte ranges', () => {
  const service = new VideoStorageService({
    endpoint: 'http://minio:9000',
    publicEndpoint: 'http://localhost:9000',
    region: 'us-east-1',
    accessKey: 'test',
    secretKey: 'x'.repeat(32),
    videosBucket: 'videos',
    thumbnailsBucket: 'thumbnails',
    presignedUrlExpiresSeconds: 900,
  });
  const parseRange = (
    value: string,
    size: number,
  ): { start: number; end: number } =>
    (
      service as unknown as {
        parseRange: (
          header: string,
          objectSize: number,
        ) => { start: number; end: number };
      }
    ).parseRange(value, size);

  it('parses a bounded range', () => {
    expect(parseRange('bytes=100-199', 1000)).toEqual({
      start: 100,
      end: 199,
    });
  });

  it('caps an open-ended range at the object size', () => {
    expect(parseRange('bytes=900-', 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({
      start: 900,
      end: 999,
    });
  });

  it.each(['bytes=1000-', 'bytes=200-100', 'items=0-10', 'bytes=0-1,2-3'])(
    'rejects an invalid or unsupported range: %s',
    (header) => {
      expect(() => parseRange(header, 1000)).toThrow(InvalidRangeException);
    },
  );
});
