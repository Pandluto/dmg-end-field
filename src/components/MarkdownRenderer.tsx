import ReactMarkdown from 'react-markdown';
import './MarkdownRenderer.css';

type MarkdownRendererProps = {
  text: string;
};

export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      components={{
        code: ({ className, children, ...props }) => {
          const match = /language-(\w+)/.exec(className || '');
          if (match) return <pre><code className={className}>{children}</code></pre>;
          return <code {...props}>{children}</code>;
        },
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
        table: ({ children }) => <div className="ai-markdown-table-wrap"><table>{children}</table></div>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
