import './WorkNodeTreeIcon.css';

type WorkNodeTreeIconProps = {
  className: string;
};

export function WorkNodeTreeIcon({ className }: WorkNodeTreeIconProps) {
  return (
    <svg className={`${className} work-node-tree-icon`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v5" />
      <path d="M7 9h10" />
      <path d="M7 9v4" />
      <path d="M17 9v4" />
      <path d="M5 13h4v4H5z" />
      <path d="M15 13h4v4h-4z" />
      <path d="M10 3h4v4h-4z" />
    </svg>
  );
}
