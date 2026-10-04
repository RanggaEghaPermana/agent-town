import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components: Components = {
  a: ({ href, children }) => href ? <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  table: ({ children }) => <div className="report-table" tabIndex={0} role="region" aria-label="Tabel laporan"><table>{children}</table></div>,
  // Reports do not need to fetch remote images automatically while being read.
  img: ({ src, alt }) => typeof src === 'string' && src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || 'Lihat gambar'}</a> : null,
};

export const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
  return <div className="report-markdown"><Markdown remarkPlugins={plugins} components={components} skipHtml>{content}</Markdown></div>;
});
