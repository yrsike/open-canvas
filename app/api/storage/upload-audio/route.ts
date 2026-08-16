import { NextResponse } from 'next/server';

import { uploadCanvasMedia } from '@/lib/uploads';

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const file = await uploadCanvasMedia({
      request,
      mediaType: 'image',
      maxSizeBytes: MAX_FILE_SIZE_BYTES,
    });

    return NextResponse.json({
      ok: true,
      urls: [file.url],
      media: {
        url: file.url,
        key: file.key,
        contentType: file.contentType,
        size: file.size,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Audio upload failed',
      },
      { status: 400 }
    );
  }
}