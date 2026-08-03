export function downloadJsonFile(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.URL.revokeObjectURL(url);
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the browser-compatible textarea path.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    document.execCommand('copy');
  } finally {
    textarea.remove();
  }
}
