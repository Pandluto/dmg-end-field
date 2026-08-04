import assert from 'node:assert/strict';
import {
  copyTextToClipboard,
  downloadJsonFile,
} from './browserFile';

type FakeElement = {
  tagName: string;
  href: string;
  download: string;
  value: string;
  style: Record<string, string>;
  clickCalls: number;
  selectCalls: number;
  removeCalls: number;
  clickImplementation: (() => void) | null;
  removeImplementation: (() => void) | null;
  select(): void;
  click(): void;
  remove(): void;
};

class FakeBody {
  readonly children: FakeElement[] = [];

  appendChild(element: FakeElement): FakeElement {
    this.children.push(element);
    return element;
  }

  removeChild(element: FakeElement): void {
    const index = this.children.indexOf(element);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
  }
}

class FakeDocument {
  readonly body = new FakeBody();
  readonly createdElements: FakeElement[] = [];
  readonly execCommandCalls: string[] = [];
  execCommandImplementation: ((command: string) => boolean) | null = null;

  createElement(tagName: string): FakeElement {
    const thisDocument = this;
    const element: FakeElement = {
      tagName,
      href: '',
      download: '',
      value: '',
      style: {},
      clickCalls: 0,
      selectCalls: 0,
      removeCalls: 0,
      clickImplementation: null,
      removeImplementation: null,
      select() {
        element.selectCalls += 1;
      },
      click() {
        element.clickCalls += 1;
        element.clickImplementation?.();
      },
      remove() {
        element.removeCalls += 1;
        element.removeImplementation?.();
        thisDocument.body.removeChild(element);
      },
    };
    element.removeImplementation = () => undefined;
    this.createdElements.push(element);
    return element;
  }

  execCommand(command: string): boolean {
    this.execCommandCalls.push(command);
    return this.execCommandImplementation?.(command) ?? true;
  }
}

type BrowserGlobals = {
  document: FakeDocument;
  navigator: { clipboard?: { writeText?: (text: string) => Promise<void> } };
  window: {
    URL: {
      createObjectURL(blob: Blob): string;
      revokeObjectURL(url: string): void;
    };
  };
};

const GLOBAL_KEYS = ['document', 'navigator', 'window'] as const;
const originalGlobalDescriptors = new Map(
  GLOBAL_KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
);

async function withBrowserGlobals<T>(globals: BrowserGlobals, callback: () => T | Promise<T>): Promise<T> {
  GLOBAL_KEYS.forEach((key) => {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      enumerable: true,
      value: globals[key],
      writable: true,
    });
  });
  try {
    return await callback();
  } finally {
    GLOBAL_KEYS.forEach((key) => {
      const descriptor = originalGlobalDescriptors.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    });
  }
}

function makeBrowserGlobals(overrides: Partial<BrowserGlobals['navigator']> = {}): BrowserGlobals {
  const document = new FakeDocument();
  const revokedUrls: string[] = [];
  const createdUrls: Array<{ blob: Blob; url: string }> = [];
  let nextUrl = 1;
  return {
    document,
    navigator: overrides,
    window: {
      URL: {
        createObjectURL(blob) {
          const url = `blob:test-${nextUrl++}`;
          createdUrls.push({ blob, url });
          return url;
        },
        revokeObjectURL(url) {
          revokedUrls.push(url);
        },
      },
    },
  };
}

const clipboardSuccessWrites: string[] = [];
const clipboardSuccess = makeBrowserGlobals({
  clipboard: {
    writeText: async (text) => {
      clipboardSuccessWrites.push(text);
    },
  },
});
await withBrowserGlobals(clipboardSuccess, async () => {
  await copyTextToClipboard('剪贴板 API 成功');
  assert.deepEqual(clipboardSuccessWrites, ['剪贴板 API 成功']);
  assert.deepEqual(clipboardSuccess.document.createdElements, []);
  assert.deepEqual(clipboardSuccess.document.execCommandCalls, []);
});

const clipboardFallback = makeBrowserGlobals({
  clipboard: {
    writeText: async () => {
      throw new Error('clipboard permission denied');
    },
  },
});
await withBrowserGlobals(clipboardFallback, async () => {
  await copyTextToClipboard('降级复制文本');
  const textarea = clipboardFallback.document.createdElements[0];
  assert.ok(textarea);
  assert.equal(textarea.tagName, 'textarea');
  assert.equal(textarea.value, '降级复制文本');
  assert.equal(textarea.style.position, 'fixed');
  assert.equal(textarea.style.opacity, '0');
  assert.equal(textarea.selectCalls, 1);
  assert.equal(textarea.removeCalls, 1);
  assert.deepEqual(clipboardFallback.document.execCommandCalls, ['copy']);
  assert.deepEqual(clipboardFallback.document.body.children, []);
});

const noClipboardFallback = makeBrowserGlobals();
await withBrowserGlobals(noClipboardFallback, async () => {
  await copyTextToClipboard('没有 Clipboard API');
  const textarea = noClipboardFallback.document.createdElements[0];
  assert.ok(textarea);
  assert.equal(textarea.value, '没有 Clipboard API');
  assert.equal(textarea.selectCalls, 1);
  assert.equal(textarea.removeCalls, 1);
  assert.deepEqual(noClipboardFallback.document.execCommandCalls, ['copy']);
  assert.deepEqual(noClipboardFallback.document.body.children, []);
});

const fallbackFailure = makeBrowserGlobals();
const fallbackFailureError = new Error('execCommand failed');
fallbackFailure.document.execCommandImplementation = () => {
  throw fallbackFailureError;
};
await withBrowserGlobals(fallbackFailure, async () => {
  await assert.rejects(
    copyTextToClipboard('复制失败但必须清理'),
    (error) => error === fallbackFailureError,
  );
  const textarea = fallbackFailure.document.createdElements[0];
  assert.ok(textarea);
  assert.equal(textarea.removeCalls, 1);
  assert.deepEqual(fallbackFailure.document.body.children, []);
});

const downloadGlobals = makeBrowserGlobals();
const downloadGlobalsCreatedBlobs: Blob[] = [];
const downloadGlobalsRevokedUrls: string[] = [];
await withBrowserGlobals(downloadGlobals, async () => {
  const value = { name: '下载内容', nested: { count: 2 } };
  downloadGlobals.window.URL.createObjectURL = (blob) => {
    downloadGlobalsCreatedBlobs.push(blob);
    return 'blob:download-json';
  };
  downloadGlobals.window.URL.revokeObjectURL = (url) => {
    downloadGlobalsRevokedUrls.push(url);
  };

  downloadJsonFile('equipment-share.json', value);
  const link = downloadGlobals.document.createdElements[0];
  assert.ok(link);
  assert.equal(link.tagName, 'a');
  assert.equal(link.href, 'blob:download-json');
  assert.equal(link.download, 'equipment-share.json');
  assert.equal(link.clickCalls, 1);
  assert.equal(link.removeCalls, 1);
  assert.deepEqual(downloadGlobals.document.body.children, []);
  assert.deepEqual(downloadGlobalsRevokedUrls, ['blob:download-json']);
  assert.equal(downloadGlobalsCreatedBlobs.length, 1);
  assert.equal(downloadGlobalsCreatedBlobs[0].type, 'application/json;charset=utf-8');
  assert.equal(
    await downloadGlobalsCreatedBlobs[0].text(),
    JSON.stringify(value, null, 2),
  );
});

const downloadClickFailure = makeBrowserGlobals();
const downloadClickFailureError = new Error('download click failed');
const downloadClickFailureRevokedUrls: string[] = [];
downloadClickFailure.window.URL.createObjectURL = () => 'blob:click-failure';
downloadClickFailure.window.URL.revokeObjectURL = (url) => {
  downloadClickFailureRevokedUrls.push(url);
};
await withBrowserGlobals(downloadClickFailure, async () => {
  const linkFactory = downloadClickFailure.document.createElement.bind(downloadClickFailure.document);
  downloadClickFailure.document.createElement = (tagName) => {
    const link = linkFactory(tagName);
    if (tagName === 'a') {
      link.clickImplementation = () => {
        throw downloadClickFailureError;
      };
    }
    return link;
  };

  await assert.rejects(
    Promise.resolve().then(() => downloadJsonFile('click-failure.json', { ok: false })),
    (error) => error === downloadClickFailureError,
  );
  const link = downloadClickFailure.document.createdElements[0];
  assert.ok(link);
  assert.equal(link.removeCalls, 1);
  assert.deepEqual(downloadClickFailure.document.body.children, []);
  assert.deepEqual(downloadClickFailureRevokedUrls, ['blob:click-failure']);
});

GLOBAL_KEYS.forEach((key) => {
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(globalThis, key),
    originalGlobalDescriptors.get(key),
    `${key} global descriptor must be restored after every fake-browser test`,
  );
});

console.log('browserFile Clipboard, fallback, download, and global cleanup contract: PASS');
