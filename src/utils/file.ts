import { UsageError } from '../errors/base.js';
import type { ContentPart, TextContentPart, ImageContentPart } from '../types/llm.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function isImageFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  const extMatch = lowerPath.match(/\.(jpg|jpeg|png|gif|webp)(?:\?|#|$)/);
  if (extMatch) {
    return true;
  }
  if (
    lowerPath.endsWith('.jpg') ||
    lowerPath.endsWith('.jpeg') ||
    lowerPath.endsWith('.png') ||
    lowerPath.endsWith('.gif') ||
    lowerPath.endsWith('.webp')
  ) {
    return true;
  }
  return false;
}

export function isRemoteUrl(filePath: string): boolean {
  return filePath.startsWith('http://') || filePath.startsWith('https://');
}

export function getMimeType(ext: string): string {
  const lowerExt = ext.toLowerCase();
  switch (lowerExt) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export async function readFileAsBase64DataUrl(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new UsageError(`文件不存在: ${filePath}`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new UsageError(`文件过大（最大 10MB）: ${filePath}`);
  }

  const lastDotIndex = filePath.lastIndexOf('.');
  const ext = lastDotIndex !== -1 ? filePath.slice(lastDotIndex) : '';
  const mimeType = getMimeType(ext);

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  return `data:${mimeType};base64,${base64}`;
}

export async function readFileAsText(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new UsageError(`文件不存在: ${filePath}`);
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new UsageError(`文件过大（最大 10MB）: ${filePath}`);
  }

  return await file.text();
}

export async function buildAttachmentContentParts(
  filePaths: string[],
  userMessage: string
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [];

  for (const filePath of filePaths) {
    if (isRemoteUrl(filePath)) {
      if (isImageFile(filePath)) {
        const imagePart: ImageContentPart = {
          type: 'image_url',
          image_url: {
            url: filePath
          }
        };
        parts.push(imagePart);
        continue;
      } else {
        const lastDotIndex = filePath.lastIndexOf('.');
        const ext = lastDotIndex !== -1 ? filePath.slice(lastDotIndex) : '';
        throw new UsageError(`不支持的文件类型: ${ext}`);
      }
    }

    if (isImageFile(filePath)) {
      const dataUrl = await readFileAsBase64DataUrl(filePath);
      const imagePart: ImageContentPart = {
        type: 'image_url',
        image_url: {
          url: dataUrl
        }
      };
      parts.push(imagePart);
    } else {
      const content = await readFileAsText(filePath);
      const basename = filePath.split('/').pop() || filePath.split('\\').pop() || filePath;
      const textPart: TextContentPart = {
        type: 'text',
        text: `[文件: ${basename}]\n${content}`
      };
      parts.push(textPart);
    }
  }

  const userMessagePart: TextContentPart = {
    type: 'text',
    text: userMessage
  };
  parts.push(userMessagePart);

  return parts;
}
