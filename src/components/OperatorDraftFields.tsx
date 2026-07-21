import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildWeaponSearchIndex, searchWeapons } from '../utils/weaponFuzzySearch';

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${keyPrefix}-b-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${keyPrefix}-c-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <span key={`${keyPrefix}-t-${index}`}>{part}</span>;
  });
}
export function renderMiniMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.split('\n');
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems;
    listItems = [];
    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {items.map((item, index) => (
          <li key={`li-${index}`}>{renderInlineMarkdown(item, `list-${nodes.length}-${index}`)}</li>
        ))}
      </ul>
    );
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    if (line.startsWith('- ')) {
      listItems.push(line.slice(2));
      return;
    }

    flushList();

    if (line.startsWith('## ')) {
      nodes.push(<h4 key={`h4-${index}`}>{renderInlineMarkdown(line.slice(3), `h4-${index}`)}</h4>);
      return;
    }

    if (line.startsWith('# ')) {
      nodes.push(<h3 key={`h3-${index}`}>{renderInlineMarkdown(line.slice(2), `h3-${index}`)}</h3>);
      return;
    }

    nodes.push(<p key={`p-${index}`}>{renderInlineMarkdown(line, `p-${index}`)}</p>);
  });

  flushList();
  return nodes;
}

interface SearchablePathSelectProps {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
}

export function SearchablePathSelect({ value, options, placeholder, onChange }: SearchablePathSelectProps) {
  const [keyword, setKeyword] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const searchIndex = useMemo(() => buildWeaponSearchIndex(options), [options]);
  const matchedOptions = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      return options.slice(0, 40);
    }
    const results = searchWeapons(trimmed, searchIndex);
    return results.slice(0, 40);
  }, [keyword, options, searchIndex]);

  useEffect(() => {
    setKeyword(value);
  }, [value]);

  return (
    <div className="operator-draft-searchable-select">
      <input
        value={keyword}
        onChange={(event) => {
          const nextKeyword = event.target.value;
          setKeyword(nextKeyword);
          setIsOpen(true);
          onChange(nextKeyword);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setIsOpen(false);
            setKeyword(value);
          }, 120);
        }}
        placeholder={placeholder}
      />
      {isOpen ? (
        <div className="operator-draft-searchable-select-list">
          {matchedOptions.length ? (
            matchedOptions.map((option) => (
              <button
                type="button"
                key={option}
                className={`operator-draft-searchable-option${value === option ? ' is-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setKeyword(option);
                  onChange(option);
                  setIsOpen(false);
                }}
              >
                {option}
              </button>
            ))
          ) : (
            <div className="operator-draft-searchable-empty">无匹配结果</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
