import { useMemo, useRef, useState } from 'react';
import { detectImageRoot } from '../../platform/resources/resourceReleaseCore.ts';
import {
  buildResourceRelease,
  type ResourceReleaseBuildProgress,
  type ResourceReleaseInputImage,
} from '../../platform/resources/resourceReleasePackager.ts';
import './ResourcePackagerPage.css';

type BrowserFileHandle = {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
};

type BrowserDirectoryHandle = {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<BrowserFileHandle | BrowserDirectoryHandle>;
};

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<BrowserDirectoryHandle>;
};

type SelectedImage = {
  sourcePath: string;
  relativePath: string;
  file: File;
};

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isLocalPackagerHost(): boolean {
  return ['127.0.0.1', 'localhost'].includes(window.location.hostname);
}

async function readDirectoryFiles(
  handle: BrowserDirectoryHandle,
  prefix = '',
  output: Array<{ path: string; file: File }> = [],
): Promise<Array<{ path: string; file: File }>> {
  for await (const entry of handle.values()) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') await readDirectoryFiles(entry, entryPath, output);
    else output.push({ path: entryPath, file: await entry.getFile() });
  }
  return output;
}

function normalizeSelectedImages(files: Array<{ path: string; file: File }>): {
  mode: string;
  images: SelectedImage[];
} {
  const detected = detectImageRoot(files.map((entry) => entry.path));
  const filesByPath = new Map(files.map((entry) => [entry.path.replace(/\\/g, '/'), entry.file]));
  return {
    mode: detected.mode,
    images: detected.files.map((entry) => {
      const file = filesByPath.get(entry.sourcePath);
      if (!file) throw new Error(`无法读取图片：${entry.sourcePath}`);
      return { ...entry, file };
    }),
  };
}

function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export function ResourcePackagerPage() {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dataInputRef = useRef<HTMLInputElement>(null);
  const [imageLabel, setImageLabel] = useState('');
  const [imageMode, setImageMode] = useState('');
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [shareDataFile, setShareDataFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<ResourceReleaseBuildProgress | null>(null);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState('');
  const [builtVersion, setBuiltVersion] = useState('');
  const localHost = isLocalPackagerHost();
  const imageBytes = useMemo(
    () => images.reduce((total, image) => total + image.file.size, 0),
    [images],
  );
  const progressPercent = progress?.total
    ? Math.round(progress.completed / progress.total * 100)
    : 0;

  const selectImageDirectory = async () => {
    setMessage('');
    const picker = (window as PickerWindow).showDirectoryPicker;
    if (!picker) {
      imageInputRef.current?.click();
      return;
    }
    try {
      const handle = await picker({ mode: 'read' });
      const files = await readDirectoryFiles(handle);
      const normalized = normalizeSelectedImages(files);
      setImages(normalized.images);
      setImageMode(normalized.mode);
      setImageLabel(handle.name);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFallbackDirectory = (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const entries = [...files].map((file) => ({
        path: (file.webkitRelativePath || file.name).replace(/^[^/]+\//, ''),
        file,
      }));
      const normalized = normalizeSelectedImages(entries);
      setImages(normalized.images);
      setImageMode(normalized.mode);
      setImageLabel(files[0].webkitRelativePath.split('/')[0] || '所选目录');
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const build = async () => {
    if (!shareDataFile || images.length === 0 || building) return;
    setBuilding(true);
    setBuiltVersion('');
    setMessage('');
    try {
      const shareData = JSON.parse((await shareDataFile.text()).replace(/^\uFEFF/, '')) as unknown;
      const releaseImages: ResourceReleaseInputImage[] = [];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        releaseImages.push({
          relativePath: image.relativePath,
          bytes: new Uint8Array(await image.file.arrayBuffer()),
        });
        if ((index + 1) % 50 === 0 || index + 1 === images.length) {
          setProgress({
            stage: 'validating',
            completed: index + 1,
            total: images.length,
            label: `正在读取图片 ${index + 1}/${images.length}`,
          });
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
      }
      const result = await buildResourceRelease({
        shareData,
        shareDataFileName: shareDataFile.name,
        images: releaseImages,
        onProgress: setProgress,
      });
      downloadBytes(result.fileName, result.bytes);
      setBuiltVersion(result.manifest.releaseVersion);
      setMessage(
        `已生成并下载 ${result.fileName}（${formatBytes(result.bytes.byteLength)}）。`
        + '把这一份 ZIP 交给 Codex 发布即可。',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBuilding(false);
    }
  };

  if (!localHost) {
    return (
      <main className="resource-packager-entry">
        <section className="resource-packager-card is-blocked">
          <p>本机工具</p>
          <h1>资源发包工具只在本机开放</h1>
          <span>请通过 http://127.0.0.1:3030/#/settings/resource-packager 打开。</span>
        </section>
      </main>
    );
  }

  return (
    <main className="resource-packager-entry">
      <section className="resource-packager-card">
        <header>
          <div>
            <p>Resource Release Builder</p>
            <h1>完整资源发包</h1>
            <span>选择图片目录和一份 Share Data，版本号与校验值会自动生成。</span>
          </div>
          <em>仅本机运行 · 不上传文件</em>
        </header>

        <div className="resource-packager-inputs">
          <article className={images.length ? 'is-ready' : ''}>
            <small>01 / 图片目录</small>
            <strong>{imageLabel || '选择完整图片目录'}</strong>
            <span>
              {images.length
                ? `${images.length} 张图片 · ${formatBytes(imageBytes)} · 识别为 ${imageMode}`
                : '兼容 assets/images、images 或直接图片根目录'}
            </span>
            <button type="button" disabled={building} onClick={() => void selectImageDirectory()}>
              {images.length ? '重新选择目录' : '选择图片目录'}
            </button>
          </article>
          <article className={shareDataFile ? 'is-ready' : ''}>
            <small>02 / Share Data</small>
            <strong>{shareDataFile?.name || '选择完整数据包 JSON'}</strong>
            <span>
              {shareDataFile
                ? `${formatBytes(shareDataFile.size)} · 将只提取正式资料库与共享排轴`
                : '不读取 max.json、buff.json 等早期预制数据'}
            </span>
            <button type="button" disabled={building} onClick={() => dataInputRef.current?.click()}>
              {shareDataFile ? '重新选择数据' : '选择 Share Data'}
            </button>
          </article>
        </div>

        <input
          ref={imageInputRef}
          hidden
          multiple
          type="file"
          onChange={(event) => handleFallbackDirectory(event.target.files)}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
        <input
          ref={dataInputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => setShareDataFile(event.target.files?.[0] || null)}
        />

        {progress && building && (
          <div className="resource-packager-progress" aria-live="polite">
            <div><span>{progress.label}</span><strong>{progressPercent}%</strong></div>
            <i><span style={{ width: `${progressPercent}%` }} /></i>
          </div>
        )}
        {message && (
          <p className={`resource-packager-message${builtVersion ? ' is-success' : ''}`} role="status">
            {message}
          </p>
        )}

        <footer>
          <div>
            <span>输出内容</span>
            <strong>发布清单 + 标准数据 + 完整图片 ZIP</strong>
            {builtVersion && <small>版本 {builtVersion}</small>}
          </div>
          <button
            className="resource-packager-build"
            type="button"
            disabled={building || !shareDataFile || images.length === 0}
            onClick={() => void build()}
          >
            {building ? '正在生成…' : '生成并下载资源包'}
          </button>
        </footer>
      </section>
    </main>
  );
}
