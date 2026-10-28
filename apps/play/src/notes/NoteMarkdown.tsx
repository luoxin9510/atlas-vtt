import { createElement, type ReactElement, type ReactNode } from 'react';
import type { Nodes, Root, RootContent, Table, TableCell } from 'mdast';
import type { SharedNote } from '../../../../src/app/online/protocol/fork.ts';
import { assetImageOf, isHttpsUrl, noteIdOf } from '../../../../src/app/online/protocol/noteLinks.ts';
import type { Loader } from '../assets/useAssetUrl.ts';
import { readQuoteHead } from './callout.ts';
import { NoteImage } from './NoteImage.tsx';

export interface NoteMarkdownProps {
  tree: Root;
  notes: readonly SharedNote[];
  onOpen: (id: string) => void;
  assets: Loader;
}

interface Context {
  readonly listed: ReadonlySet<string>;
  readonly onOpen: (id: string) => void;
  readonly assets: Loader;
}

const ALIGNS = new Set(['left', 'right', 'center']);
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function children(nodes: readonly (Nodes | RootContent)[], context: Context): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, context, index));
}

function cell(node: TableCell, header: boolean, align: string | null | undefined, context: Context, key: number): ReactElement {
  const className = align !== null && align !== undefined && ALIGNS.has(align) ? `atlas-play-align-${align}` : undefined;
  return createElement(header ? 'th' : 'td', { key, className }, children(node.children, context));
}

function renderTable(table: Table, context: Context, key: number): ReactElement {
  const row = (index: number, header: boolean): ReactElement => (
    <tr key={index}>{table.children[index]!.children.map((node, column) => cell(node, header, table.align?.[column], context, column))}</tr>
  );
  const body = table.children.slice(1).map((_, index) => row(index + 1, false));
  return <table key={key}>{table.children.length > 0 ? <thead>{row(0, true)}</thead> : null}<tbody>{body}</tbody></table>;
}

function renderLink(url: string, content: ReactNode[], context: Context, key: number): ReactNode {
  if (isHttpsUrl(url)) return <a key={key} href={url} target="_blank" rel="noopener noreferrer">{content}</a>;
  const id = noteIdOf(url);
  if (id !== null && context.listed.has(id)) return <button key={key} type="button" className="atlas-play-note-link" onClick={() => context.onOpen(id)}>{content}</button>;
  return <span key={key}>{content}</span>;
}

function renderQuote(node: Extract<Nodes, { type: 'blockquote' }>, context: Context, key: number): ReactElement {
  const split = readQuoteHead(node);
  if (split === null) return <blockquote key={key}>{children(node.children, context)}</blockquote>;
  const title = children(split.title, context);
  const hasTitle = split.title.length > 0;
  if (!split.known) {
    return <blockquote key={key}>{hasTitle ? <p>{title}</p> : null}{children(split.body, context)}</blockquote>;
  }
  return (
    <div key={key} className={`atlas-play-callout atlas-play-callout-${split.head.type}`}>
      {hasTitle ? <div className="atlas-play-callout-title">{title}</div> : null}
      <div className="atlas-play-callout-body">{children(split.body, context)}</div>
    </div>
  );
}

/** One mdast node as React. Only the kinds the GM's copy can hold are drawn; every other kind (html, math, definitions, footnotes, unknown) is dropped with its content. */
function renderNode(node: Nodes | RootContent, context: Context, key: number): ReactNode {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'paragraph':
      return <p key={key}>{children(node.children, context)}</p>;
    case 'heading':
      return createElement(HEADINGS[Math.min(Math.max(node.depth, 1), 6) - 1]!, { key }, children(node.children, context));
    case 'emphasis':
      return <em key={key}>{children(node.children, context)}</em>;
    case 'strong':
      return <strong key={key}>{children(node.children, context)}</strong>;
    case 'delete':
      return <del key={key}>{children(node.children, context)}</del>;
    case 'inlineCode':
      return <code key={key}>{node.value}</code>;
    case 'code':
      return <pre key={key}><code>{node.value}</code></pre>;
    case 'break':
      return <br key={key} />;
    case 'thematicBreak':
      return <hr key={key} />;
    case 'blockquote':
      return renderQuote(node, context, key);
    case 'list': {
      const start = node.start !== null && node.start !== undefined && Number.isSafeInteger(node.start) ? node.start : undefined;
      return node.ordered ? <ol key={key} start={start}>{children(node.children, context)}</ol> : <ul key={key}>{children(node.children, context)}</ul>;
    }
    case 'listItem':
      return (
        <li key={key}>
          {typeof node.checked === 'boolean' ? <input type="checkbox" checked={node.checked} disabled readOnly /> : null}
          {children(node.children, context)}
        </li>
      );
    case 'table':
      return renderTable(node, context, key);
    case 'link':
      return renderLink(node.url, children(node.children, context), context, key);
    case 'image': {
      const ref = assetImageOf(node.url);
      return ref === null ? null : <NoteImage key={key} assetRef={ref} alt={node.alt ?? ''} assets={context.assets} />;
    }
    default:
      return null;
  }
}

/** A note's tree as React elements through an element allowlist: no HTML strings, no `style`, no event props from data. */
export function NoteMarkdown({ tree, notes, onOpen, assets }: NoteMarkdownProps): ReactElement {
  const context: Context = { listed: new Set(notes.map((note) => note.id)), onOpen, assets };
  return <div className="atlas-play-note">{children(tree.children, context)}</div>;
}
