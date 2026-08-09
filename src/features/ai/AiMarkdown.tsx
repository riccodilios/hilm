import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { isSafeHref } from '@/lib/safe-url'
import { cn } from '@/lib/utils'

/** Hide trailing ```actions blocks from chat display (still applied via action chips). */
function displayContent(content: string) {
  return content.replace(/```actions(?:\s+json)?\s*\n[\s\S]*?```/gi, '').trim()
}

export function AiMarkdown({
  content,
  className,
  inverse = false,
}: {
  content: string
  className?: string
  /** High-contrast bubble (user): light text on dark bg in light theme, etc. */
  inverse?: boolean
}) {
  const body = displayContent(content)
  if (!body) return null

  return (
    <div
      className={cn(
        'ai-md text-[0.9375rem] leading-6 [overflow-wrap:anywhere]',
        inverse
          ? '[&_*]:text-inherit [&_a]:underline [&_code]:bg-black/15 [&_pre]:bg-black/20'
          : 'text-foreground [&_a]:text-accent [&_code]:bg-surface-3 [&_pre]:bg-surface-3',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-3 text-xl font-semibold tracking-tight first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-2.5 text-base font-semibold first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mb-2.5 list-disc space-y-1 ps-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2.5 list-decimal space-y-1 ps-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-6">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => {
            if (!isSafeHref(href)) {
              return <span className="underline underline-offset-2">{children}</span>
            }
            const external = /^https?:\/\//i.test(href!)
            return (
              <a
                href={href}
                {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="underline underline-offset-2"
              >
                {children}
              </a>
            )
          },
          blockquote: ({ children }) => (
            <blockquote className="mb-2.5 border-s-2 border-current/30 ps-3 opacity-90 last:mb-0">
              {children}
            </blockquote>
          ),
          code: ({ className: codeClass, children }) => {
            const isBlock = Boolean(codeClass?.includes('language-')) || String(children).includes('\n')
            if (isBlock) {
              return (
                <code className={cn('font-mono text-[0.8rem] leading-5', codeClass)}>{children}</code>
              )
            }
            return (
              <code className="rounded-md px-1.5 py-0.5 font-mono text-[0.8rem]">{children}</code>
            )
          },
          pre: ({ children }) => (
            <pre className="mb-2.5 overflow-x-auto rounded-xl p-3 font-mono text-[0.8rem] leading-5 last:mb-0">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-3 border-current/20" />,
          table: ({ children }) => (
            <div className="mb-2.5 overflow-x-auto last:mb-0">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-current/20 px-2 py-1 text-start font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-current/20 px-2 py-1 align-top">{children}</td>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
