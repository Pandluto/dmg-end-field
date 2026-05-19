import { createPortal } from 'react-dom';

interface ImageManagerToastProps {
  message: string | null;
}

export function ImageManagerToast({ message }: ImageManagerToastProps) {
  if (!message || typeof document === 'undefined') return null;

  return createPortal(
    <div className="image-manager-toast" role="status" aria-live="polite">
      {message}
    </div>,
    document.body,
  );
}
