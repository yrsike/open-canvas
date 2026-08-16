import { promises as fs } from 'node:fs';
import path from 'node:path';

import type {
  StorageDownloadUploadOptions,
  StorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
} from './core';

export interface LocalStorageConfig {
  rootDir: string;
  publicUrlPrefix: string;
  pathPrefix?: string;
}

function normalizePathPrefix(pathPrefix?: string) {
  return String(pathPrefix || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function joinPath(...parts: string[]) {
  return parts.filter(Boolean).join('/');
}

function sanitizeKey(key: string) {
  return key
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .join('/');
}

/**
 * 本地存储 provider：
 * - 把文件写入 Next.js 的 `public/` 子目录，通过静态资源 URL 直接访问
 * - 适合 local-first 项目；不需要任何云端凭据
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly config: LocalStorageConfig;

  constructor(config: LocalStorageConfig) {
    this.config = config;
  }

  private buildObjectKey(key: string) {
    const normalizedKey = sanitizeKey(key);
    const pathPrefix = normalizePathPrefix(this.config.pathPrefix);
    return joinPath(pathPrefix, normalizedKey);
  }

  private resolveLocalPath(key: string) {
    const objectKey = this.buildObjectKey(key);
    const root = path.resolve(this.config.rootDir);
    const fullPath = path.resolve(root, objectKey);
    const normalizedRoot = root.replace(/[\\/]+$/, '') + path.sep;
    if (!fullPath.startsWith(normalizedRoot) && fullPath !== root.replace(/[\\/]+$/, '')) {
      throw new Error('Invalid storage key: path traversal detected');
    }
    return { fullPath, objectKey };
  }

  getPublicUrl = (options: { key: string }): string => {
    const { objectKey } = this.resolveLocalPath(options.key);
    const base = this.config.publicUrlPrefix.replace(/\/+$/, '');
    return `${base}/${objectKey}`;
  };

  exists = async (options: { key: string }): Promise<boolean> => {
    try {
      const { fullPath } = this.resolveLocalPath(options.key);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  };

  async uploadFile(
    options: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    try {
      const { fullPath, objectKey } = this.resolveLocalPath(options.key);
      const body =
        options.body instanceof Uint8Array
          ? options.body
          : new Uint8Array(options.body);

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, body);

      return {
        success: true,
        provider: this.name,
        key: options.key,
        filename: objectKey.split('/').pop(),
        url: this.getPublicUrl({ key: options.key }),
      };
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async downloadAndUpload(
    options: StorageDownloadUploadOptions
  ): Promise<StorageUploadResult> {
    try {
      const response = await fetch(options.url);
      if (!response.ok) {
        return {
          success: false,
          provider: this.name,
          error: `HTTP error: ${response.status}`,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      return this.uploadFile({
        body: new Uint8Array(arrayBuffer),
        key: options.key,
        contentType: options.contentType,
        disposition: options.disposition,
      });
    } catch (error) {
      return {
        success: false,
        provider: this.name,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
