"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { AssistantLogo, ASSISTANTS } from "./AssistantLogos";
import { TrafficLights } from "./DeviceFrames";

// The homepage's MCP setup panel (SUP-65): a dark terminal-style window with
// one tab per AI tool. Each tab shows exactly what that tool needs (a command
// or a config file), with a copy button. The Claude Code tab also shows an
// example of what using it looks like. The formats are each tool's own
// documented ones; docs/mcp.md has them too, with links to those docs.

type Client = {
  id: string;
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
      file: "Terminal",
      prompt: true,
      config: `claude mcp add --transport http support-triage \\\n  ${endpoint} \\\n  --header "Authorization: Bearer ${TOKEN}"`,
    },
    {
      id: "cursor",
      file: "~/.cursor/mcp.json",
      config: JSON.stringify(
        { mcpServers: { "support-triage": { url: endpoint, headers: { Authorization: `Bearer ${TOKEN}` } } } },
        null,
        2
      ),
    },
    {
      id: "vscode",
      file: ".vscode/mcp.json",
      // A workspace file is often committed, so VS Code asks for the token
      // (stored in its secret storage) instead of it sitting in the file.
      config: JSON.stringify(
        {
          inputs: [{ type: "promptString", id: "support-triage-token", description: "Support Triage access token", password: true }],
          servers: {
            "support-triage": {
              type: "http",
              url: endpoint,
              headers: { Authorization: "Bearer ${input:support-triage-token}" },
            },
          },
        },
        null,
        2
      ),
    },
    {
      id: "codex",
      file: "~/.codex/config.toml",
      config: `# The token is read from SUPPORT_TRIAGE_TOKEN in your environment.\n[mcp_servers.support-triage]\nurl = "${endpoint}"\nbearer_token_env_var = "SUPPORT_TRIAGE_TOKEN"`,
    },
  ];
}

export function McpConnect({ endpoint }: { endpoint: string }) {
  const configs = useMemo(() => clients(endpoint), [endpoint]);
  const [active, setActive] = useState(0);
  // The last copy's outcome, shown on the button and announced, for a moment.
  const [copyState, setCopyState] = useState<"copied" | "failed" | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const assistant = ASSISTANTS[active];
  const client = configs[active];

  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(null), 2000);
    return () => clearTimeout(timer);
  }, [copyState]);

  function select(i: number) {
    setActive(i);
    setCopyState(null);
  }

  // Arrow keys, Home and End move between tabs (the WAI-ARIA tabs pattern).
  function onKeyDown(e: KeyboardEvent) {
    const last = ASSISTANTS.length - 1;
    const next =
      e.key === "ArrowRight" ? (active === last ? 0 : active + 1)
      : e.key === "ArrowLeft" ? (active === 0 ? last : active - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabs.current[next]?.focus();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(client.config);
      setCopyState("copied");
    } catch {
      // No clipboard access: say so; the text is still there to select.
      setCopyState("failed");
    }
  }

  return (
    <div className="overflow-hidden rounded-xl bg-[#0F1117] shadow-[0_24px_60px_-24px_rgba(15,17,23,0.55)] ring-1 ring-black/10">
      <div className="relative flex h-10 items-center border-b border-white/[.08] px-3.5">
        <TrafficLights />
        <span className="absolute inset-x-0 truncate px-24 text-center font-mono text-[12px] text-[#8B90A0]">{client.file}</span>
        {/* In the title bar, so it never covers the text on a narrow screen. */}
        <button
          type="button"
          onClick={copy}
          className="relative ml-auto rounded-md border border-white/[.12] px-2.5 py-0.5 text-[12px] font-medium text-[#C9CDD8] transition-colors hover:bg-white/[.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A5B4FC]"
        >
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
          <span className="sr-only"> the {assistant.label} setup</span>
        </button>
        <span role="status" className="sr-only">
          {copyState === "copied" ? "Copied" : copyState === "failed" ? "Couldn't copy. Select the text instead." : ""}
        </span>
      </div>

      <div role="tablist" aria-label="AI tool" onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-white/[.08] px-2 pt-2">
        {ASSISTANTS.map((c, i) => (
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
            onClick={() => select(i)}
            className={`flex shrink-0 items-center gap-2 rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#A5B4FC] ${
              i === active ? "border-[#A5B4FC] text-white" : "border-transparent text-[#8B90A0] hover:text-[#C9CDD8]"
            }`}
          >
            <AssistantLogo mark={c.mark} className="h-3.5 w-3.5" />
            {c.label}
          </button>
        ))}
      </div>

      {/* Focusable, so keyboard users can reach it and scroll a long line. */}
      <div
        role="tabpanel"
        tabIndex={0}
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${client.id}`}
        className="focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#A5B4FC]"
      >
        <pre className="overflow-x-auto px-5 pb-5 pt-4 font-mono text-[12.5px] leading-[1.7] text-[#E6E8EE]">
          <code>
            {client.prompt ? (
              <span aria-hidden="true" className="select-none text-[#8B90A0]">
                ${" "}
              </span>
            ) : null}
            {client.config}
          </code>
        </pre>
        {client.id === "claude-code" ? (
          // What it looks like in use: one question, one tool call, the
          // answer. The tool and its input are real; the answer is the
          // assistant's own wording of the result, so it's marked as an example.
          <div className="border-t border-white/[.08] px-5 py-4 font-mono text-[12.5px] leading-[1.7]">
            <p className="mb-2 font-sans text-[11px] font-medium uppercase tracking-[0.08em] text-[#8B90A0]">Example</p>
            <p className="text-white">
              <span aria-hidden="true" className="select-none text-[#8B90A0]">
                &gt;{" "}
              </span>
              Any news on my invoice ticket?
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
