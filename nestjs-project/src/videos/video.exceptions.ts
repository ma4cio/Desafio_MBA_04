import { DomainException } from '../common/exceptions/domain.exception';

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video was not found');
  }
}

export class InvalidVideoStateException extends DomainException {
  constructor(message = 'Video is not in the required state') {
    super('INVALID_VIDEO_STATE', 409, message);
  }
}

export class InvalidMultipartUploadException extends DomainException {
  constructor(message = 'Multipart upload parts are invalid') {
    super('INVALID_MULTIPART_UPLOAD', 400, message);
  }
}

export class UploadedObjectMismatchException extends DomainException {
  constructor() {
    super(
      'UPLOADED_OBJECT_MISMATCH',
      422,
      'Uploaded object does not match the declared size or content type',
    );
  }
}

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video processing is not complete');
  }
}

export class InvalidRangeException extends DomainException {
  constructor() {
    super('INVALID_RANGE', 416, 'Requested byte range is not satisfiable');
  }
}
