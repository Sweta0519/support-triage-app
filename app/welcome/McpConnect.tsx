"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { AssistantLogo, type AssistantMark } from "./AssistantLogos";

// The homepage's MCP setup panel (SUP-65): a dark terminal-style window with
// one tab per AI tool. Each tab shows exactly what that tool needs (a command
// or a config file), with a copy button. The Claude Code tab also shows an
// example of what using it looks like. The formats are each tool's own
// documented ones; docs/mcp.md lists them too.

type Client = {
  id: string;
  label: string;
  mark: AssistantMark;
  // The window's title: the file to edit, or the terminal.
  file: string;
  // What the copy button copies.
  config: string;
  // The command line, shown after a "$" prompt.
  prompt?: boolean;
};

const TOKEN = "st_your_token";

function clients(endpoint: string): Client[] {
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      mark: "claude",
      file: "Terminal",
      prompt: true,
      config: `claude mcp add --transport http support-triage \\\n  ${endpoint} \\\n  --header "Authorization: Bearer ${TOKEN}"`,
    },
    {
      id: "cursor",
      label: "Cursor",
      mark: "cursor",
      file: "~/.cursor/mcp.json",
      config: JSON.stringify(
        { mcpServers: { "support-triage": { url: endpoint, headers: { Authorization: `Bearer ${TOKEN}` } } } },
        null,
        2
      ),
    },
    {
      id: "vscode",
      label: "VS Code",
      mark: "githubcopilot",
      file: ".vscode/mcp.json",
      config: JSON.stringify(
        { servers: { "support-triage": { type: "http", url: endpoint, headers: { Authorization: `Bearer ${TOKEN}` } } } },
        null,
        2
      ),
    },
    {
      id: "codex",
      label: "Codex",
      mark: "openai",
      file: "~/.codex/config.toml",
      config: `# The token is read from SUPPORT_TRIAGE_TOKEN in your environment.\n[mcp_servers.support-triage]\nurl = "${endpoint}"\nbearer_token_env_var = "SUPPORT_TRIAGE_TOKEN"`,
    },
  ];
}

export function McpConnect({ endpoint }: { endpoint: string }) {
  const list = clients(endpoint);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const client = list[active];

  // Arrow keys move between tabs (the WAI-ARIA tabs pattern).
  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (active + step + list.length) % list.length;
    setActive(next);
    tabs.current[next]?.focus();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(client.config);
      setCopied(client.id);
    } catch {
      // No clipboard access: the text is still there to select.
      setCopied(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl bg-[#0F1117] shadow-[0_24px_60px_-24px_rgba(15,17,23,0.55)] ring-1 ring-black/10">
      <div className="relative flex h-10 items-center border-b border-white/[.08] px-3.5">
        <span aria-hidden="true" className="flex gap-2">
          <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
          <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
          <span className="h-3 w-3 rounded-full bg-[#28C840]" />
        </span>
        <span className="absolute inset-x-0 truncate px-24 text-center font-mono text-[12px] text-[#8B90A0]">{client.file}</span>
        {/* In the title bar, so it never covers the text on a narrow screen. */}
        <button
          type="button"
          onClick={copy}
          className="relative ml-auto rounded-md border border-white/[.12] px-2.5 py-0.5 text-[12px] font-medium text-[#C9CDD8] transition-colors hover:bg-white/[.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A5B4FC]"
        >
          {copied === client.id ? "Copied" : "Copy"}
          <span className="sr-only"> the {client.label} setup</span>
        </button>
      </div>

      <div role="tablist" aria-label="AI tool" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-white/[.08] px-2 pt-2">
        {list.map((c, i) => (
          <button
            key={c.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${c.id}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            className={`flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#A5B4FC] ${
              i === active ? "border-[#A5B4FC] text-white" : "border-transparent text-[#8B90A0] hover:text-[#C9CDD8]"
            }`}
          >
            <AssistantLogo mark={c.mark} className="h-3.5 w-3.5" />
            {c.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${client.id}`}>
        <pre className="overflow-x-auto px-5 pb-5 pt-4 font-mono text-[12.5px] leading-[1.7] text-[#E6E8EE]">
          <code>
            {client.prompt ? <span className="select-none text-[#8B90A0]">$ </span> : null}
            {client.config}
          </code>
        </pre>
        {client.id === "claude-code" ? (
          // What it looks like in use: one question, one tool call, the answer.
          <div aria-label="Example" className="border-t border-white/[.08] px-5 py-4 font-mono text-[12.5px] leading-[1.7]">
            <p className="text-white">
              <span className="select-none text-[#8B90A0]">&gt; </span>Any news on my invoice ticket?
            </p>
            <p className="mt-2 text-[#A5B4FC]">⏺ support-triage · get_ticket (number: 1484)</p>
            <p className="text-[#C9CDD8]">
              #1484 is in progress. Sam from Support replied an hour ago: they&apos;ve found the export bug and will email
              your invoice today.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
